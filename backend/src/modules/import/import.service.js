import * as XLSX from 'xlsx';

const MONTHS_MAP = {
  janeiro: 1, jan: 1,
  fevereiro: 2, fev: 2,
  marco: 3, mar: 3, março: 3,
  abril: 4, abr: 4,
  maio: 5, mai: 5,
  junho: 6, jun: 6,
  julho: 7, jul: 7,
  agosto: 8, ago: 8,
  setembro: 9, set: 9,
  outubro: 10, out: 10,
  novembro: 11, nov: 11,
  dezembro: 12, dez: 12,
};

function parseMonth(val) {
  if (typeof val === 'number') {
    if (Number.isInteger(val) && val >= 1 && val <= 12) return val;
    if (val >= 30_000 && val <= 80_000) return XLSX.SSF.parse_date_code(val)?.m || null;
    if (val >= 12_000 && val < 30_000) return ((Math.trunc(val) - 1) % 12) + 1;
    return null;
  }
  if (!val) return null;
  const clean = String(val).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const numeric = parseInt(clean, 10);
  if (MONTHS_MAP[clean]) return MONTHS_MAP[clean];
  if (/^\d{1,2}$/.test(clean) && Number.isInteger(numeric) && numeric >= 1 && numeric <= 12) return numeric;
  const monthName = Object.keys(MONTHS_MAP).find((name) => new RegExp(`\\b${name}\\b`).test(clean));
  if (monthName) return MONTHS_MAP[monthName];
  const monthYearMatch = clean.match(/^(\d{1,2})[/-]\d{2,4}$/);
  const dateMatch = clean.match(/^\d{1,2}[/-](\d{1,2})[/-]\d{2,4}$/);
  const datePart = monthYearMatch?.[1] || dateMatch?.[1];
  if (datePart) {
    const month = Number(datePart);
    return month >= 1 && month <= 12 ? month : null;
  }
  return null;
}

function parseMoney(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const clean = String(val).replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

// Descobre quais colunas existem em uma tabela do SQLite
function getTableColumns(db, tableName) {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return new Set(cols.map((c) => c.name));
}

function pickColumn(columns, candidates, tableName, purpose) {
  const column = candidates.find((candidate) => columns.has(candidate));
  if (!column) {
    throw new Error(`A tabela "${tableName}" não possui uma coluna compatível para ${purpose}.`);
  }
  return column;
}

function normalizeRow(row) {
  const normalized = {};
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = key
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
    normalized[normalizedKey] = value;
  }
  return normalized;
}

function cleanText(value) {
  if (value === false || value == null) return '';
  return String(value).trim();
}

function normalizeKey(value) {
  return cleanText(value).toLocaleLowerCase('pt-BR');
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export async function processSpreadsheetImport(db, userId, fileBuffer, { replaceExisting = false } = {}) {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  const sheetNames = workbook.SheetNames;

  // 1. Procura especificamente pela aba "Banco De Dados"
  let targetSheetName = sheetNames.find((s) =>
    s.toLowerCase().replace(/\s+/g, '').includes('bancodedados')
  );

  if (!targetSheetName) {
    targetSheetName = sheetNames[0];
  }

  const sheet = workbook.Sheets[targetSheetName];
  const sourceRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  if (!sourceRows || sourceRows.length === 0) {
    throw new Error(`A aba "${targetSheetName}" está vazia ou sem dados válidos.`);
  }

  const rows = sourceRows.map(normalizeRow);
  const hasPurchaseDetailColumn = rows.some((row) => 'detalhedacompra' in row || 'detalhecompra' in row);
  const carriedFields = [
    'detalhedacompra',
    'detalhecompra',
    'descricao',
    'categoria',
    'pessoa',
    'nome',
    'cartao',
    'banco',
    'valortotal',
    'total',
    'qtdparcelas',
    'parcelas',
  ];
  const previousValues = {};
  const purchases = [];
  const purchasesBySignature = new Map();
  let installmentAmountsCalculated = 0;

  for (const [index, row] of rows.entries()) {
    const hasExplicitRowData = Object.values(row).some((value) => cleanText(value) !== '');
    if (!hasExplicitRowData) continue;

    for (const field of carriedFields) {
      if (cleanText(row[field])) previousValues[field] = row[field];
      else if (previousValues[field] !== undefined) row[field] = previousValues[field];
    }

    const description = cleanText(
      row.detalhedacompra ||
      row.detalhecompra ||
      (!hasPurchaseDetailColumn && (row.descricao || row.compra || row.item)),
    );
    const categoryName = cleanText(
      row.categoria ||
      (hasPurchaseDetailColumn && row.descricao),
    );
    const personName = cleanText(row.pessoa || row.nome);
    const cardName = cleanText(row.cartao || row.banco);
    const totalRaw = row.valortotal || row.total;
    let installmentAmount = parseMoney(row.valordaparcela || row.parcelavalor || row.valor);
    const totalInstallments = Math.max(1, parseInt(row.qtdparcelas || row.parcelas, 10) || 1);
    let total = parseMoney(totalRaw);
    if (total <= 0) total = installmentAmount * totalInstallments;

    let month = parseMonth(row.mes);
    let year = parseInt(row.ano, 10);
    const monthIndex = parseInt(row.numerocorrespondenteaomes, 10);
    if ((!month || !Number.isInteger(year)) && Number.isInteger(monthIndex) && monthIndex > 0) {
      month = ((monthIndex - 1) % 12) + 1;
      year = Math.floor((monthIndex - 1) / 12);
    }
    if ((!Number.isInteger(month) || month < 1 || month > 12) && installmentAmount <= 0) {
      continue;
    }

    if (!description && !categoryName && installmentAmount <= 0 && total <= 0) continue;
    if (!description) {
      throw new Error(`Não encontrei "Detalhe da compra" na linha ${index + 2} da aba "${targetSheetName}".`);
    }
    if (total <= 0) {
      throw new Error(`O valor total da compra é inválido na linha ${index + 2} da aba "${targetSheetName}".`);
    }

    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new Error(`O mês "${cleanText(row.mes) || 'vazio'}" é inválido na linha ${index + 2} da aba "${targetSheetName}".`);
    }
    if (!Number.isInteger(year) || year < 1900 || year > 9999) {
      throw new Error(`O ano é inválido na linha ${index + 2} da aba "${targetSheetName}".`);
    }

    const period = year * 12 + month - 1;
    const signature = JSON.stringify([
      normalizeKey(description),
      normalizeKey(categoryName),
      normalizeKey(personName),
      normalizeKey(cardName),
      Math.round(total * 100),
      totalInstallments,
    ]);
    const candidates = purchasesBySignature.get(signature) || [];
    const purchase = candidates
      .filter((candidate) =>
        candidate.installments.length < candidate.totalInstallments &&
        candidate.installments.every((installment) => installment.period !== period) &&
        candidate.lastPeriod < period
      )
      .sort((a, b) => {
        const aContinues = a.lastPeriod === period - 1;
        const bContinues = b.lastPeriod === period - 1;
        return Number(bContinues) - Number(aContinues) || a.firstRow - b.firstRow;
      })[0];
    const target = purchase || {
      description,
      categoryName,
      personName,
      cardName,
      total,
      totalInstallments,
      installments: [],
      firstRow: index,
      lastPeriod: -Infinity,
    };

    if (installmentAmount <= 0) {
      const installmentNumber = target.installments.length + 1;
      const regularAmount = roundMoney(total / totalInstallments);
      installmentAmount = installmentNumber === totalInstallments
        ? roundMoney(total - regularAmount * (totalInstallments - 1))
        : regularAmount;
      installmentAmountsCalculated++;
    }

    target.installments.push({ period, month, year, amount: installmentAmount });
    target.lastPeriod = period;
    if (!purchase) {
      purchases.push(target);
      candidates.push(target);
      purchasesBySignature.set(signature, candidates);
    }
  }

  if (purchases.length === 0) {
    throw new Error(`Nenhuma compra válida foi encontrada na aba "${targetSheetName}".`);
  }

  const results = {
    batchId: `batch_${Date.now()}`,
    peopleCreated: 0,
    cardsCreated: 0,
    purchasesCreated: 0,
    installmentsCreated: 0,
    installmentAmountsCalculated,
    replacedExisting: replaceExisting,
    purchasesReplaced: 0,
  };

  // Inspeciona as colunas reais do seu banco para não errar nenhum INSERT
  const cardCols = getTableColumns(db, 'cards');
  const purchaseCols = getTableColumns(db, 'purchases');
  const installmentCols = getTableColumns(db, 'installments');
  const categoryCols = getTableColumns(db, 'categories');

  // Nome da coluna de limite do cartão (limit_amount ou limit)
  const cardLimitCol = pickColumn(cardCols, ['limit_amount', 'limit'], 'cards', 'limite');
  const purchaseTotalCol = pickColumn(purchaseCols, ['total', 'total_amount'], 'purchases', 'valor total');
  const purchaseCountCol = pickColumn(
    purchaseCols,
    ['installments_count', 'count', 'total_installments'],
    'purchases',
    'quantidade de parcelas',
  );
  const installmentNumCol = pickColumn(
    installmentCols,
    ['number', 'installment_number'],
    'installments',
    'número da parcela',
  );
  const categoryIdCol = purchaseCols.has('category_id') && categoryCols.size ? 'category_id' : null;

  // 2. Caches de Pessoas e Cartões existentes
  const peopleMap = new Map();
  db.prepare('SELECT id, name FROM people WHERE user_id = ?').all(userId)
    .forEach((p) => peopleMap.set(p.name.toLowerCase().trim(), p.id));

  const cardsMap = new Map();
  db.prepare('SELECT id, name FROM cards WHERE user_id = ?').all(userId)
    .forEach((c) => cardsMap.set(c.name.toLowerCase().trim(), c.id));

  const categoriesMap = new Map();
  if (categoryIdCol) {
    db.prepare('SELECT id, name FROM categories WHERE user_id = ?').all(userId)
      .forEach((category) => categoriesMap.set(normalizeKey(category.name), category.id));
  }

  function getOrCreatePerson(rawName) {
    if (!rawName) return null;
    const name = String(rawName).trim();
    if (!name) return null;

    const lower = name.toLowerCase();
    if (peopleMap.has(lower)) return peopleMap.get(lower);

    const res = db.prepare('INSERT INTO people (user_id, name) VALUES (?, ?)').run(userId, name);
    peopleMap.set(lower, res.lastInsertRowid);
    results.peopleCreated++;
    return res.lastInsertRowid;
  }

  function getOrCreateCard(rawCardName) {
    if (!rawCardName) return null;
    const name = String(rawCardName).trim();
    if (!name || name.toLowerCase() === 'dinheiro' || name.toLowerCase() === 'pix') return null;

    const lower = name.toLowerCase();
    if (cardsMap.has(lower)) return cardsMap.get(lower);

    const columns = ['user_id', 'name', cardLimitCol];
    const values = [userId, name, 0];
    const optionalCardValues = {
      color: '#0f6b66',
      bank: 'outro',
      issuer: 'Outro',
      brand: 'Outro',
      due_day: 10,
      closing_day: 3,
    };

    for (const [column, value] of Object.entries(optionalCardValues)) {
      if (cardCols.has(column)) {
        columns.push(column);
        values.push(value);
      }
    }

    const insertCardSql = `INSERT INTO cards (${columns.map((column) => `\`${column}\``).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
    const res = db.prepare(insertCardSql).run(...values);
    cardsMap.set(lower, res.lastInsertRowid);
    results.cardsCreated++;
    return res.lastInsertRowid;
  }

  function getOrCreateCategory(rawCategoryName) {
    if (!categoryIdCol || !rawCategoryName) return null;
    const name = String(rawCategoryName).trim();
    const key = normalizeKey(name);
    if (categoriesMap.has(key)) return categoriesMap.get(key);
    const result = db.prepare('INSERT INTO categories (user_id, name) VALUES (?, ?)').run(userId, name);
    categoriesMap.set(key, result.lastInsertRowid);
    return result.lastInsertRowid;
  }

  // Monta prepared statements blindados para Purchase e Installment
  const purchaseColumns = [
    'user_id',
    'person_id',
    'card_id',
    'description',
    purchaseTotalCol,
    purchaseCountCol,
  ];
  if (categoryIdCol) purchaseColumns.push(categoryIdCol);
  if (purchaseCols.has('split_group_id')) purchaseColumns.push('split_group_id');
  const purchaseSql = `INSERT INTO purchases (${purchaseColumns.map((column) => `\`${column}\``).join(', ')}) VALUES (${purchaseColumns.map(() => '?').join(', ')})`;

  const insertPurchaseStmt = db.prepare(purchaseSql);

  // Installment INSERT
  const installmentColumns = ['purchase_id', installmentNumCol, 'month', 'year', 'amount', 'paid'];
  if (installmentCols.has('user_id')) installmentColumns.unshift('user_id');
  const installmentValues = installmentColumns.map((column) => column === 'paid' ? '0' : '?');
  const insertInstallmentSql = `INSERT INTO installments (${installmentColumns.map((column) => `\`${column}\``).join(', ')}) VALUES (${installmentValues.join(', ')})`;
  const insertInstallmentStmt = db.prepare(insertInstallmentSql);

  // 3. Execução em Transação SQLite Atômica
  const runTransaction = db.transaction(() => {
    if (replaceExisting) {
      db.prepare(`
        DELETE FROM installments
        WHERE purchase_id IN (SELECT id FROM purchases WHERE user_id = ? AND vehicle_expense_id IS NULL)
      `).run(userId);
      results.purchasesReplaced = db.prepare('DELETE FROM purchases WHERE user_id = ? AND vehicle_expense_id IS NULL').run(userId).changes;
    }

    for (const purchase of purchases) {
      const personId = getOrCreatePerson(purchase.personName || 'Principal');
      const cardId = getOrCreateCard(purchase.cardName || 'Cartão Principal');
      const categoryId = getOrCreateCategory(purchase.categoryName);
      const params = [
        userId,
        personId,
        cardId,
        purchase.description,
        purchase.total,
        purchase.totalInstallments,
      ];
      if (categoryIdCol) params.push(categoryId);
      if (purchaseCols.has('split_group_id')) {
        params.push(results.batchId);
      }

      const pRes = insertPurchaseStmt.run(...params);
      const purchaseId = pRes.lastInsertRowid;
      results.purchasesCreated++;

      purchase.installments
        .sort((a, b) => a.period - b.period)
        .forEach((installment, index) => {
          const installmentParams = [
            ...(installmentCols.has('user_id') ? [userId] : []),
            purchaseId,
            index + 1,
            installment.month,
            installment.year,
            installment.amount,
          ];
          insertInstallmentStmt.run(...installmentParams);
          results.installmentsCreated++;
        });
    }
  });

  runTransaction();

  return results;
}

// FUNÇÃO PARA REVERTER / LIMPAR A IMPORTAÇÃO
export function undoSpreadsheetImport(db, userId, batchId = null) {
  const purchaseCols = getTableColumns(db, 'purchases');

  if (batchId && purchaseCols.has('split_group_id')) {
    const purchases = db.prepare('SELECT id FROM purchases WHERE user_id = ? AND split_group_id = ?').all(userId, batchId);
    for (const p of purchases) {
      db.prepare('DELETE FROM installments WHERE purchase_id = ?').run(p.id);
      db.prepare('DELETE FROM purchases WHERE id = ?').run(p.id);
    }
    return { undoneCount: purchases.length };
  } else {
    // Apaga todas as compras e parcelas criadas por este usuário
    const deleteInstallments = db.prepare(`
      DELETE FROM installments WHERE purchase_id IN (SELECT id FROM purchases WHERE user_id = ? AND vehicle_expense_id IS NULL)
    `).run(userId);

    const deletePurchases = db.prepare('DELETE FROM purchases WHERE user_id = ? AND vehicle_expense_id IS NULL').run(userId);

    return { undoneCount: deletePurchases.changes };
  }
}