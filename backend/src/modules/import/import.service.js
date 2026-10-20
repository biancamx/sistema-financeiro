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
  if (typeof val === 'number') return Math.min(12, Math.max(1, val));
  if (!val) return new Date().getMonth() + 1;
  const clean = String(val).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  return MONTHS_MAP[clean] || (parseInt(clean, 10) || new Date().getMonth() + 1);
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
  try {
    const cols = db.prepare(`PRAGMA table_info(${tableName})`).all();
    return new Set(cols.map((c) => c.name));
  } catch {
    return new Set();
  }
}

export async function processSpreadsheetImport(db, userId, fileBuffer) {
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
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  if (!rawRows || rawRows.length === 0) {
    throw new Error(`A aba "${targetSheetName}" está vazia ou sem dados válidos.`);
  }

  const results = {
    batchId: `batch_${Date.now()}`,
    peopleCreated: 0,
    cardsCreated: 0,
    purchasesCreated: 0,
    installmentsCreated: 0,
  };

  // Inspeciona as colunas reais do seu banco para não errar nenhum INSERT
  const cardCols = getTableColumns(db, 'cards');
  const purchaseCols = getTableColumns(db, 'purchases');
  const installmentCols = getTableColumns(db, 'installments');

  // Nome da coluna de limite do cartão (limit_amount ou limit)
  const cardLimitCol = cardCols.has('limit_amount') ? 'limit_amount' : '`limit`';
  // Nome da coluna de total da compra (total ou total_amount)
  const purchaseTotalCol = purchaseCols.has('total') ? 'total' : 'total_amount';
  // Nome da coluna de quantidade de parcelas (count ou total_installments)
  const purchaseCountCol = purchaseCols.has('count') ? 'count' : 'total_installments';
  // Nome da coluna de número da parcela (number ou installment_number)
  const installmentNumCol = installmentCols.has('number') ? 'number' : 'installment_number';

  // 2. Caches de Pessoas e Cartões existentes
  const peopleMap = new Map();
  db.prepare('SELECT id, name FROM people WHERE user_id = ?').all(userId)
    .forEach((p) => peopleMap.set(p.name.toLowerCase().trim(), p.id));

  const cardsMap = new Map();
  db.prepare('SELECT id, name FROM cards WHERE user_id = ?').all(userId)
    .forEach((c) => cardsMap.set(c.name.toLowerCase().trim(), c.id));

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

    // INSERT adaptativo seguro para cards
    let insertCardSql = `INSERT INTO cards (user_id, name, ${cardLimitCol}, color, bank, brand`;
    let valuesSql = `VALUES (?, ?, 0, '#0f6b66', 'outro', 'outro'`;

    if (cardCols.has('due_day')) {
      insertCardSql += `, due_day, closing_day`;
      valuesSql += `, 10, 3`;
    }
    insertCardSql += `) ${valuesSql});`;

    const res = db.prepare(insertCardSql).run(userId, name);
    cardsMap.set(lower, res.lastInsertRowid);
    results.cardsCreated++;
    return res.lastInsertRowid;
  }

  // Monta prepared statements blindados para Purchase e Installment
  let purchaseSql = `INSERT INTO purchases (user_id, person_id, card_id, description, ${purchaseTotalCol}, ${purchaseCountCol}`;
  let purchaseValSql = `VALUES (?, ?, ?, ?, ?, ?`;

  if (purchaseCols.has('split_group_id')) {
    purchaseSql += `, split_group_id`;
    purchaseValSql += `, ?`;
  }
  purchaseSql += `) ${purchaseValSql});`;

  const insertPurchaseStmt = db.prepare(purchaseSql);

  // Installment INSERT
  const insertInstallmentSql = `
    INSERT INTO installments (purchase_id, ${installmentNumCol}, month, year, amount, paid)
    VALUES (?, ?, ?, ?, ?, 0);
  `;
  const insertInstallmentStmt = db.prepare(insertInstallmentSql);

  // 3. Execução em Transação SQLite Atômica
  const runTransaction = db.transaction(() => {
    for (const row of rawRows) {
      // Normalização de cabeçalhos
      const cleanRow = {};
      for (const k of Object.keys(row)) {
        const normKey = k
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]/g, '')
          .trim();
        cleanRow[normKey] = row[k];
      }

      const desc = cleanRow.descricao || cleanRow.compra || cleanRow.item;
      const personName = cleanRow.pessoa || cleanRow.nome;
      const cardName = cleanRow.cartao || cleanRow.banco;
      const totalAmountRaw = cleanRow.valortotal || cleanRow.total;
      const installmentAmountRaw = cleanRow.valordaparcela || cleanRow.parcelavalor || cleanRow.valor;
      const totalInstallmentsRaw = cleanRow.qtdparcelas || cleanRow.parcelas || 1;
      const monthRaw = cleanRow.mes;
      const yearRaw = cleanRow.ano;

      if (!desc && !installmentAmountRaw) continue;

      const singleAmount = parseMoney(installmentAmountRaw);
      let totalAmount = parseMoney(totalAmountRaw);
      const totalInstallments = Math.max(1, parseInt(totalInstallmentsRaw, 10) || 1);

      if (totalAmount <= 0) {
        totalAmount = singleAmount * totalInstallments;
      }

      const month = parseMonth(monthRaw);
      const year = parseInt(yearRaw, 10) || new Date().getFullYear();

      const personId = getOrCreatePerson(personName || 'Principal');
      const cardId = getOrCreateCard(cardName || 'Cartão Principal');

      // Executa INSERT de Compra
      const params = [
        userId,
        personId,
        cardId,
        String(desc || 'Compra Importada').trim(),
        totalAmount,
        totalInstallments,
      ];
      if (purchaseCols.has('split_group_id')) {
        params.push(results.batchId);
      }

      const pRes = insertPurchaseStmt.run(...params);
      const purchaseId = pRes.lastInsertRowid;
      results.purchasesCreated++;

      // Executa INSERT de Parcela
      insertInstallmentStmt.run(
        purchaseId,
        1,
        month,
        year,
        singleAmount > 0 ? singleAmount : totalAmount
      );
      results.installmentsCreated++;
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
      DELETE FROM installments WHERE purchase_id IN (SELECT id FROM purchases WHERE user_id = ?)
    `).run(userId);

    const deletePurchases = db.prepare('DELETE FROM purchases WHERE user_id = ?').run(userId);

    return { undoneCount: deletePurchases.changes };
  }
}