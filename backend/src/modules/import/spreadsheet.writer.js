import { normalizeText } from './spreadsheet.reader.js';

const SECTION_MAP = {
  receitas: 'income',
  beneficios: 'benefits',
  investimentos: 'investments',
  descontos: 'deductions',
  alimentacao: 'food',
  veiculos: 'vehicle',
  despesas_variaveis: 'fixed',
  variadas: 'misc',
  moradia: 'housing',
};

function findOrCreateNamedRecord(db, table, userId, name, fields = {}) {
  const existing = db.prepare(`SELECT id FROM ${table} WHERE user_id = ? AND LOWER(TRIM(name)) = ?`)
    .get(userId, name.toLowerCase());
  if (existing) return Number(existing.id);

  const entries = Object.entries(fields);
  const columns = ['user_id', 'name', ...entries.map(([column]) => column)];
  const placeholders = columns.map(() => '?').join(', ');
  const result = db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`)
    .run(userId, name, ...entries.map(([, value]) => value));
  return Number(result.lastInsertRowid);
}

export function executeSpreadsheetImport(db, userId, analyzedData) {
  const summary = {
    peopleUpserted: 0,
    cardsUpserted: 0,
    purchasesUpserted: 0,
    installmentsUpserted: 0,
    budgetsUpserted: 0,
    birthdaysUpserted: 0,
  };

  db.transaction(() => {
    const personIds = new Map();
    const people = new Set([
      ...analyzedData.people,
      ...analyzedData.purchasesGrouped.map((purchase) => purchase.personName),
      ...analyzedData.monthlyBudgets.map((budget) => budget.person),
    ]);
    for (const name of people) {
      const clean = String(name).trim();
      const existing = db.prepare('SELECT id FROM people WHERE user_id = ? AND LOWER(TRIM(name)) = ?')
        .get(userId, clean.toLowerCase());
      const id = existing?.id ?? db.prepare('INSERT INTO people (user_id, name) VALUES (?, ?)')
        .run(userId, clean).lastInsertRowid;
      personIds.set(normalizeText(clean), Number(id));
      if (!existing) summary.peopleUpserted++;
    }

    const cardIds = new Map();
    const cards = new Set([
      ...analyzedData.cards,
      ...analyzedData.purchasesGrouped.map((purchase) => purchase.cardName),
    ]);
    for (const name of cards) {
      const clean = String(name).trim();
      const existing = db.prepare('SELECT id FROM cards WHERE user_id = ? AND LOWER(TRIM(name)) = ?')
        .get(userId, clean.toLowerCase());
      const limit = Number(analyzedData.limits?.[normalizeText(clean)] || 0);
      const id = existing?.id ?? db.prepare(
        `INSERT INTO cards (user_id, name, limit_amount, issuer, brand)
         VALUES (?, ?, ?, 'Outro', 'Outro')`,
      ).run(userId, clean, limit).lastInsertRowid;
      if (existing && limit > 0) {
        db.prepare('UPDATE cards SET limit_amount = ? WHERE id = ? AND user_id = ?').run(limit, id, userId);
      }
      cardIds.set(normalizeText(clean), Number(id));
      if (!existing) summary.cardsUpserted++;
    }

    const categoryIds = new Map();
    for (const name of analyzedData.categories || []) {
      const clean = String(name).trim();
      if (!clean) continue;
      categoryIds.set(normalizeText(clean), findOrCreateNamedRecord(db, 'categories', userId, clean));
    }

    const findPurchases = db.prepare(
      `SELECT id FROM purchases
       WHERE user_id = ? AND person_id = ? AND card_id = ? AND COALESCE(category_id, 0) = COALESCE(?, 0)
         AND LOWER(TRIM(description)) = ? AND total = ? AND installments_count = ?
         AND COALESCE(purchase_date, '') = COALESCE(?, '')
       ORDER BY id`,
    );
    const usedPurchaseIds = new Set();
    const insertPurchase = db.prepare(
      `INSERT INTO purchases
       (user_id, description, category_id, person_id, card_id, purchase_date, total, installments_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const findInstallment = db.prepare(
      'SELECT id, paid_amount FROM installments WHERE user_id = ? AND purchase_id = ? AND month = ? AND year = ?',
    );
    const insertInstallment = db.prepare(
      `INSERT INTO installments (user_id, purchase_id, number, year, month, amount)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const updateInstallment = db.prepare(
      'UPDATE installments SET number = ?, amount = ? WHERE id = ? AND paid_amount = 0',
    );

    for (const purchase of analyzedData.purchasesGrouped) {
      const personId = personIds.get(normalizeText(purchase.personName));
      const cardId = cardIds.get(normalizeText(purchase.cardName));
      if (!personId || !cardId) {
        throw new Error(`Não foi possível localizar pessoa ou cartão da compra "${purchase.description}".`);
      }
      const categoryId = purchase.category
        ? categoryIds.get(normalizeText(purchase.category))
          ?? findOrCreateNamedRecord(db, 'categories', userId, purchase.category.trim())
        : null;
      const purchaseDate = /^\d{4}-\d{2}-\d{2}$/.test(purchase.purchaseDate || '')
        ? purchase.purchaseDate
        : null;
      const existingPurchases = findPurchases.all(
        userId,
        personId,
        cardId,
        categoryId,
        purchase.description.toLowerCase().trim(),
        purchase.totalAmount,
        purchase.totalInstallments,
        purchaseDate,
      );
      const existing = existingPurchases.find((candidate) => !usedPurchaseIds.has(candidate.id));
      let purchaseId = existing?.id;
      if (!purchaseId) {
        purchaseId = insertPurchase.run(
          userId,
          purchase.description.trim(),
          categoryId,
          personId,
          cardId,
          purchaseDate,
          purchase.totalAmount,
          purchase.totalInstallments,
        ).lastInsertRowid;
        summary.purchasesUpserted++;
      }
      usedPurchaseIds.add(Number(purchaseId));

      const installments = [...purchase.installments].sort((a, b) => (a.year * 12 + a.month) - (b.year * 12 + b.month));
      installments.forEach((installment, index) => {
        const current = findInstallment.get(userId, purchaseId, installment.month, installment.year);
        if (!current) {
          insertInstallment.run(userId, purchaseId, index + 1, installment.year, installment.month, installment.amount);
          summary.installmentsUpserted++;
        } else {
          updateInstallment.run(index + 1, installment.amount, current.id);
        }
      });
    }

    const findSheet = db.prepare(
      'SELECT id FROM budget_sheets WHERE user_id = ? AND person_id = ? AND year = ?',
    );
    const insertSheet = db.prepare(
      'INSERT INTO budget_sheets (user_id, person_id, year) VALUES (?, ?, ?)',
    );
    const findRow = db.prepare(
      `SELECT id FROM budget_rows
       WHERE user_id = ? AND sheet_id = ? AND section = ? AND LOWER(TRIM(label)) = ?`,
    );
    const insertRow = db.prepare(
      `INSERT INTO budget_rows (user_id, sheet_id, section, label, position)
       VALUES (?, ?, ?, ?, COALESCE((SELECT MAX(position) + 1 FROM budget_rows WHERE sheet_id = ?), 0))`,
    );
    const upsertCell = db.prepare(
      `INSERT INTO budget_cells (row_id, user_id, month, value) VALUES (?, ?, ?, ?)
       ON CONFLICT(row_id, month) DO UPDATE SET value = excluded.value`,
    );
    const deleteCell = db.prepare('DELETE FROM budget_cells WHERE row_id = ? AND month = ?');

    for (const budget of analyzedData.monthlyBudgets) {
      const personId = personIds.get(normalizeText(budget.person));
      if (!personId) throw new Error(`Pessoa não encontrada para a planilha "${budget.person}".`);
      const section = SECTION_MAP[normalizeText(budget.section)];
      if (!section) throw new Error(`Seção de planilha não reconhecida: "${budget.section}".`);

      let sheet = findSheet.get(userId, personId, budget.year);
      if (!sheet) {
        const sheetId = insertSheet.run(userId, personId, budget.year).lastInsertRowid;
        sheet = { id: sheetId };
      }

      let row = findRow.get(userId, sheet.id, section, budget.label.toLowerCase().trim());
      if (!row) {
        const rowId = insertRow.run(userId, sheet.id, section, budget.label.trim(), sheet.id).lastInsertRowid;
        row = { id: rowId };
      }
      for (const month of budget.months) {
        if (month.amount === null) {
          deleteCell.run(row.id, month.month);
        } else {
          upsertCell.run(row.id, userId, month.month, month.amount);
        }
      }
      summary.budgetsUpserted++;
    }

    const findBirthday = db.prepare(
      'SELECT id FROM birthdays WHERE user_id = ? AND LOWER(TRIM(name)) = ? AND day = ? AND month = ?',
    );
    const insertBirthday = db.prepare(
      'INSERT INTO birthdays (user_id, name, day, month) VALUES (?, ?, ?, ?)',
    );
    for (const birthday of analyzedData.birthdays) {
      if (findBirthday.get(userId, birthday.name.toLowerCase().trim(), birthday.day, birthday.month)) continue;
      insertBirthday.run(userId, birthday.name.trim(), birthday.day, birthday.month);
      summary.birthdaysUpserted++;
    }
  })();

  return summary;
}
