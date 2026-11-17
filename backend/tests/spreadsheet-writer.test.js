import { test } from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { openDb } from '../src/db/index.js';
import { analyzeSpreadsheet, parseMoney } from '../src/modules/import/spreadsheet.reader.js';
import { executeSpreadsheetImport } from '../src/modules/import/spreadsheet.writer.js';
import { createBudgetsService } from '../src/modules/budgets/budgets.service.js';

test('parseMoney preserves decimal values from spreadsheet display strings', () => {
  assert.equal(parseMoney('2.65'), 2.65);
  assert.equal(parseMoney('2,65'), 2.65);
  assert.equal(parseMoney('R$ 374.926,80'), 374926.8);
  assert.equal(parseMoney('R$ 1,234.56'), 1234.56);
});

test('spreadsheet analysis preserves monthly categories and workbook values', () => {
  const workbook = XLSX.utils.book_new();
  const monthlyRow = (label, value, total = value) => [
    label,
    value,
    ...Array(11).fill(''),
    total,
  ];
  const budget = [
    ['Pessoa 01'],
    ['', 'Pessoa 01 2026'],
    ['Categoria', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro', 'Total'],
    ['RECEITAS'],
    monthlyRow('Salário', 100),
    ['Total', 100, ...Array(11).fill(0), 100],
    ['RECEITAS'],
    monthlyRow('Alimentação', 20),
    monthlyRow('VR combustível', 10),
    ['Total', 30, ...Array(11).fill(0), 30],
    ['Descontos (salário) / impostos'],
    monthlyRow('INSS/FGTS', 5),
    ['Total', 5, ...Array(11).fill(0), 5],
    ['Alimentação x Combustível'],
    monthlyRow('Mercantil', 30),
    monthlyRow('Variadas', 0),
    ['Total', 30, ...Array(11).fill(0), 30],
    ['DESPESAS VARIÁVEIS'],
    ['Cartão de crédito'],
    monthlyRow('Cartao de exemplo', 999),
    ['Total', 999, ...Array(11).fill(0), 999],
    ['Variadas'],
    monthlyRow('Diversas', 1),
    ['Total', 1, ...Array(11).fill(0), 1],
    ['Moradia'],
    ['Energia', '', 50, ...Array(10).fill(''), 50, 50],
    ['Total', 0, 50, ...Array(10).fill(0), 50],
    ['RESUMO GERAL'],
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(budget), 'Financeiro Pessoa 01');

  const purchaseRows = [
    ['Data', 'Descrição', 'Pessoa', 'Valor Total', 'Qtd. Parcelas', 'Valor da Parcela', 'Mês', 'Ano', 'Cartão'],
    ['Compra', 'Casa', 'Pessoa 01', 10, 3, 3.335, 'janeiro', 2026, 'Cartao de exemplo'],
    ['Compra', 'Casa', 'Pessoa 01', 10, 3, 3.335, 'fevereiro', 2026, 'Cartao de exemplo'],
    ['Compra', 'Casa', 'Pessoa 01', 10, 3, 3.335, 'janeiro', 2026, 'Cartao de exemplo'],
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(purchaseRows), 'Banco De Dados');

  const report = analyzeSpreadsheet(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
  const budgetRow = (section, label) => report.monthlyBudgets.find((row) => row.section === section && row.label === label);
  assert.equal(budgetRow('receitas', 'Salário').months[0].amount, 100);
  assert.equal(budgetRow('beneficios', 'Alimentação').months[0].amount, 20);
  assert.equal(budgetRow('alimentacao', 'Mercantil').months[0].amount, 30);
  assert.equal(budgetRow('alimentacao', 'Variadas').months[0].amount, 0);
  assert.equal(budgetRow('moradia', 'Energia').months[0].amount, null);
  assert.equal(budgetRow('moradia', 'Energia').months[1].amount, 50);
  assert.equal(report.monthlyBudgets.some((row) => row.label === 'Cartao de exemplo'), false);
  assert.deepEqual(report.divergences, []);
  assert.equal(report.purchasesGrouped.length, 2);
  assert.deepEqual(report.purchasesGrouped[0].installments.map((installment) => installment.amount), [3.335, 3.335]);

  const db = openDb(':memory:');
  try {
    const userId = Number(db.prepare(
      "INSERT INTO users (name, email) VALUES ('Budget test', 'budget-reader-test@example.com')",
    ).run().lastInsertRowid);
    executeSpreadsheetImport(db, userId, report);
    const personId = Number(db.prepare('SELECT id FROM people WHERE user_id = ? AND name = ?').get(userId, 'Pessoa 01').id);
    const sheet = createBudgetsService(db).getSheet(userId, personId, 2026);
    const housing = sheet.sections.find((section) => section.key === 'housing');
    const energy = housing.rows.find((row) => row.label === 'Energia');
    assert.deepEqual(energy.values.slice(0, 3), [0, 50, 0]);
    assert.equal(energy.min, 50);
    assert.equal(energy.max, 50);
    const cards = sheet.sections.find((section) => section.key === 'cards');
    assert.deepEqual(cards.totals.slice(0, 2), [6.67, 3.34]);
    executeSpreadsheetImport(db, userId, report);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM purchases WHERE user_id = ?').get(userId).count, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM installments WHERE user_id = ?').get(userId).count, 3);
  } finally {
    db.close();
  }
});

test('spreadsheet import uses the SQLite schema and is idempotent', () => {
  const db = openDb(':memory:');
  try {
    const userId = Number(db.prepare(
      "INSERT INTO users (name, email) VALUES ('Import test', 'writer-test@example.com')",
    ).run().lastInsertRowid);
    const analyzedData = {
      people: ['Pessoa 01'],
      cards: ['Cartão teste'],
      categories: ['Casa'],
      limits: { 'cartao teste': 1500 },
      purchasesGrouped: [{
        description: 'Compra teste',
        category: 'Categoria da compra',
        personName: 'Pessoa 01',
        cardName: 'Cartão teste',
        purchaseDate: null,
        totalAmount: 10,
        totalInstallments: 2,
        installments: [
          { month: 1, year: 2027, amount: 5 },
          { month: 2, year: 2027, amount: 5 },
        ],
      }],
      monthlyBudgets: [{
        person: 'Pessoa 01',
        year: 2027,
        section: 'moradia',
        label: 'Aluguel',
        months: Array.from({ length: 12 }, (_, index) => ({
          month: index + 1,
          amount: index === 0 ? parseMoney('2.65') : 0,
        })),
      }],
      birthdays: [],
    };

    const summary = executeSpreadsheetImport(db, userId, analyzedData);
    assert.deepEqual(summary, {
      peopleUpserted: 1,
      cardsUpserted: 1,
      purchasesUpserted: 1,
      installmentsUpserted: 2,
      budgetsUpserted: 1,
      birthdaysUpserted: 0,
    });
    assert.equal(db.prepare('SELECT limit_amount FROM cards WHERE user_id = ?').get(userId).limit_amount, 1500);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM categories WHERE user_id = ?').get(userId).count, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM purchases WHERE user_id = ?').get(userId).count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM installments WHERE user_id = ?').get(userId).count, 2);
    assert.equal(db.prepare('SELECT value FROM budget_cells WHERE user_id = ? AND month = 1').get(userId).value, 2.65);

    const repeat = executeSpreadsheetImport(db, userId, analyzedData);
    assert.equal(repeat.peopleUpserted, 0);
    assert.equal(repeat.cardsUpserted, 0);
    assert.equal(repeat.purchasesUpserted, 0);
    assert.equal(repeat.installmentsUpserted, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM purchases WHERE user_id = ?').get(userId).count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM budget_sheets WHERE user_id = ?').get(userId).count, 1);
  } finally {
    db.close();
  }
});
