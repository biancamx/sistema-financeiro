import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { openDb } from '../src/db/index.js';
import { processSpreadsheetImport } from '../src/modules/import/import.service.js';

test('importação usa as colunas do schema SQLite atual', async () => {
  const db = openDb(':memory:');
  try {
    const userId = db.prepare('INSERT INTO users (email, name) VALUES (?, ?)').run('import@teste.com', 'Importação').lastInsertRowid;
    const worksheet = XLSX.utils.json_to_sheet([{
      Descrição: 'Compra teste',
      Pessoa: 'Pessoa teste',
      Cartão: 'Cartão teste',
      'Valor da Parcela': 42.5,
      'Qtd Parcelas': 1,
      Mês: 'Janeiro',
      Ano: 2026,
    }]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Banco De Dados');
    const fileBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const result = await processSpreadsheetImport(db, userId, fileBuffer);

    assert.equal(result.peopleCreated, 1);
    assert.equal(result.cardsCreated, 1);
    assert.equal(result.purchasesCreated, 1);
    assert.equal(result.installmentsCreated, 1);
    assert.deepEqual(
      { ...db.prepare('SELECT total, installments_count FROM purchases').get() },
      { total: 42.5, installments_count: 1 },
    );
    assert.deepEqual(
      { ...db.prepare('SELECT user_id, number, month, year, amount FROM installments').get() },
      { user_id: userId, number: 1, month: 1, year: 2026, amount: 42.5 },
    );
  } finally {
    db.close();
  }
});

test('substituição remove compras antigas e importa a planilha na mesma transação', async () => {
  const db = openDb(':memory:');
  try {
    const userId = db.prepare('INSERT INTO users (email, name) VALUES (?, ?)').run('replace@teste.com', 'Substituição').lastInsertRowid;
    const personId = db.prepare('INSERT INTO people (user_id, name) VALUES (?, ?)').run(userId, 'Compra antiga').lastInsertRowid;
    const cardId = db.prepare('INSERT INTO cards (user_id, name) VALUES (?, ?)').run(userId, 'Cartão antigo').lastInsertRowid;
    const purchaseId = db.prepare(`
      INSERT INTO purchases (user_id, person_id, card_id, description, total, installments_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, personId, cardId, 'Lançamento antigo', 10, 1).lastInsertRowid;
    db.prepare(`
      INSERT INTO installments (user_id, purchase_id, number, year, month, amount)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, purchaseId, 1, 2026, 1, 10);

    const worksheet = XLSX.utils.json_to_sheet([{
      'Detalhe da compra': 'Compra nova',
      Descrição: 'Categoria nova',
      Pessoa: 'Pessoa nova',
      Cartão: 'Cartão novo',
      'Valor Total': 20,
      'Qtd. Parcelas': 1,
      'Valor da Parcela': 20,
      Mês: 'Janeiro',
      Ano: 2026,
    }]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Banco De Dados');
    const fileBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const result = await processSpreadsheetImport(db, userId, fileBuffer, { replaceExisting: true });

    assert.equal(result.purchasesReplaced, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM purchases WHERE user_id = ?').get(userId).count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM installments WHERE user_id = ?').get(userId).count, 1);
    assert.equal(db.prepare('SELECT description FROM purchases WHERE user_id = ?').get(userId).description, 'Compra nova');
  } finally {
    db.close();
  }
});

test('importa a aba Banco De Dados agrupando parcelas e preservando detalhe e categoria', async () => {
  const db = openDb(':memory:');
  try {
    const userId = db.prepare('INSERT INTO users (email, name) VALUES (?, ?)').run('planilha@teste.com', 'Planilha').lastInsertRowid;
    const rows = [];
    for (const [person, total, amount] of [['Pessoa 01', 120, 30], ['Pessoa 02', 80, 20]]) {
      for (let month = 1; month <= 4; month++) {
        rows.push({
          'Detalhe da compra': month === 1 ? 'Item de demonstração' : '',
          Descrição: month === 1 ? 'Categoria de teste' : false,
          Pessoa: month === 1 ? person : '',
          'Valor Total': month === 1 ? total : '',
          'Qtd. Parcelas': month === 1 ? 4 : '',
          'Valor da Parcela': person === 'Pessoa 01' && month === 4 ? '' : amount,
          Mês: month === 1
            ? '01/2026'
            : month === 2
              ? 46054
              : new Date(2026, month - 1).toLocaleString('pt-BR', { month: 'long' }),
          Ano: 2026,
          Cartão: month === 1 ? 'Cartão de demonstração' : '',
          'Número correspondente ao mês': 2026 * 12 + month,
        });
      }
    }
    rows.push({
      'Detalhe da compra': '',
      Descrição: 'Total',
      Pessoa: '',
      'Valor Total': '',
      'Qtd. Parcelas': '',
      'Valor da Parcela': '',
      Mês: 'Total',
      Ano: '',
      Cartão: '',
      'Número correspondente ao mês': '',
    });
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Banco De Dados');
    const fileBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const result = await processSpreadsheetImport(db, userId, fileBuffer);

    assert.equal(result.peopleCreated, 2);
    assert.equal(result.cardsCreated, 1);
    assert.equal(result.purchasesCreated, 2);
    assert.equal(result.installmentsCreated, 8);
    assert.equal(result.installmentAmountsCalculated, 1);
    assert.equal(result.installmentAmountsCalculated, 1);

    const purchases = db.prepare(`
      SELECT p.description, p.total, p.installments_count, pe.name AS person, cat.name AS category
      FROM purchases p
      JOIN people pe ON pe.id = p.person_id
      LEFT JOIN categories cat ON cat.id = p.category_id
      ORDER BY pe.name
    `).all();
    assert.deepEqual(purchases.map((purchase) => ({ ...purchase })), [
      { description: 'Item de demonstração', total: 120, installments_count: 4, person: 'Pessoa 01', category: 'Categoria de teste' },
      { description: 'Item de demonstração', total: 80, installments_count: 4, person: 'Pessoa 02', category: 'Categoria de teste' },
    ]);

    const installments = db.prepare(`
      SELECT i.number, i.month, i.year, i.amount, pe.name AS person
      FROM installments i
      JOIN purchases p ON p.id = i.purchase_id
      JOIN people pe ON pe.id = p.person_id
      ORDER BY pe.name, i.number
    `).all();
    assert.equal(installments.length, 8);
    for (const person of ['Pessoa 01', 'Pessoa 02']) {
      const personInstallments = installments.filter((installment) => installment.person === person);
      assert.deepEqual(personInstallments.map((installment) => installment.number), Array.from({ length: 4 }, (_, i) => i + 1));
      assert.deepEqual(personInstallments.map((installment) => installment.month), Array.from({ length: 4 }, (_, i) => i + 1));
      assert.ok(personInstallments.every((installment) => installment.year === 2026));
    }
    assert.ok(installments.filter((installment) => installment.person === 'Pessoa 01').every((installment) => installment.amount === 30));
    assert.ok(installments.filter((installment) => installment.person === 'Pessoa 02').every((installment) => installment.amount === 20));
  } finally {
    db.close();
  }
});
