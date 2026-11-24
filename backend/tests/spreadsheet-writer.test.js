import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { clearMongoMemory, createTestAccount, startMongoMemory } from './helpers/mongo.js';
import { Person } from '../src/models/Person.js';
import { Card } from '../src/models/Card.js';
import { Purchase } from '../src/models/Purchase.js';
import { Installment } from '../src/models/Installment.js';
import { parseMoney, analyzeSpreadsheet } from '../src/modules/import/spreadsheet.reader.js';
import { executeSpreadsheetImport } from '../src/modules/import/spreadsheet.writer.js';
import { createBudgetsService } from '../src/modules/budgets/budgets.service.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-spreadsheet-writer';

let stopMongo;

before(async () => {
  stopMongo = await startMongoMemory();
});

beforeEach(clearMongoMemory);

after(async () => {
  if (stopMongo) await stopMongo();
});

test('parseMoney preserves decimal values from spreadsheet display strings', () => {
  assert.equal(parseMoney('2.65'), 2.65);
  assert.equal(parseMoney('2,65'), 2.65);
  assert.equal(parseMoney('R$ 374.926,80'), 374926.8);
  assert.equal(parseMoney('R$ 1,234.56'), 1234.56);
});

test('spreadsheet analysis preserves monthly categories and workbook values', async () => {
  const workbook = XLSX.utils.book_new();
  const monthlyRow = (label, value, total = value) => [
    label,
    value,
    ...Array(11).fill(''),
    total,
  ];
  const budget = [
    ['Person 01'],
    ['', 'Person 01 2026'],
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
    monthlyRow('Card example', 999),
    ['Total', 999, ...Array(11).fill(0), 999],
    ['Variadas'],
    monthlyRow('Diversas', 1),
    ['Total', 1, ...Array(11).fill(0), 1],
    ['Moradia'],
    ['Energia', '', 50, ...Array(10).fill(''), 50, 50],
    ['Total', 0, 50, ...Array(10).fill(0), 50],
    ['RESUMO GERAL'],
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(budget), 'Financeiro Person 01');

  const purchaseRows = [
    ['Data', 'Descrição', 'Pessoa', 'Valor Total', 'Qtd. Parcelas', 'Valor da Parcela', 'Mês', 'Ano', 'Cartão'],
    ['Purchase', 'Home', 'Person 01', 10, 3, 3.335, 'janeiro', 2026, 'Example card'],
    ['Purchase', 'Home', 'Person 01', 10, 3, 3.335, 'fevereiro', 2026, 'Example card'],
    ['Purchase', 'Home', 'Person 01', 10, 3, 3.335, 'janeiro', 2026, 'Example card'],
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
  assert.equal(report.monthlyBudgets.some((row) => row.label === 'Card example'), false);
  assert.deepEqual(report.divergences, []);
  assert.equal(report.purchasesGrouped.length, 2);
  assert.deepEqual(report.purchasesGrouped[0].installments.map((installment) => installment.amount), [3.335, 3.335]);

  const account = await createTestAccount({ email: 'spreadsheet-analysis@example.invalid' });
  await executeSpreadsheetImport(String(account.user._id), report);
  const importedPerson = await Person.findOne({ userId: account.user._id, name: 'Person 01' });
  const sheet = await createBudgetsService().getSheet(
    String(account.user._id),
    String(importedPerson._id),
    2026,
  );
  const housing = sheet.sections.find((section) => section.key === 'housing');
  const energy = housing.rows.find((row) => row.label === 'Energia');
  assert.deepEqual(energy.values.slice(0, 3), [0, 50, 0]);
  assert.equal(energy.min, 50);
  assert.equal(energy.max, 50);
  const cards = sheet.sections.find((section) => section.key === 'cards');
  assert.deepEqual(cards.totals.slice(0, 2), [6.67, 3.34]);
  await executeSpreadsheetImport(String(account.user._id), report);
  assert.equal(await Purchase.countDocuments({ userId: account.user._id }), 2);
  assert.equal(await Installment.countDocuments({ userId: account.user._id }), 3);
});

test('Financeiro Geral imports non-card monthly rows into each person budget', async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['ID', 'Cartão', 'Pessoa', 'Outro', 'Categoria'],
    ['1', 'Nubank', 'Brena', '', ''],
  ]), 'Dados');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Brena'],
    ['', 'Brena 2027'],
    ['Categoria'],
    [''],
    [''],
  ]), 'Financeiro Brena');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Brena'],
    ['Mês', 'janeiro', 'fevereiro', 'março'],
    ['Nubank', 200, 210, 220],
    ['Veículo / Fixos', 15, 30, 0],
    ['Total Mês', 215, 240, 220],
    ['Status', 'Pendente', 'Pago', 'Pago'],
  ]), 'Financeiro Geral');

  const report = analyzeSpreadsheet(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
  assert.deepEqual(report.monthlyBudgets.map(({ person, year, section, label }) => (
    { person, year, section, label }
  )), [{
    person: 'Brena',
    year: 2027,
    section: 'despesas_variaveis',
    label: 'Veículo / Fixos',
  }]);

  const account = await createTestAccount({ email: 'general-finance-import@example.invalid' });
  const userId = String(account.user._id);
  await executeSpreadsheetImport(userId, report);
  const person = await Person.findOne({ userId, name: 'Brena' });
  const sheet = await createBudgetsService().getSheet(userId, String(person._id), 2027);
  const fixed = sheet.sections.find((section) => section.key === 'fixed');

  assert.deepEqual(fixed.rows.find((row) => row.label === 'Veículo / Fixos').values.slice(0, 3), [15, 30, 0]);
  assert.equal(fixed.rows.some((row) => row.label === 'Nubank'), false);
  assert.equal(fixed.rows.some((row) => row.label === 'Total Mês' || row.label === 'Status'), false);
});

test('spreadsheet import upserts purchases, installments and budgets in MongoDB', async () => {
  const account = await createTestAccount({ email: 'spreadsheet-writer@example.invalid' });
  const analyzedData = {
    people: ['Person 01'],
    cards: ['Test card'],
    categories: ['Home'],
    limits: { 'test card': 1500 },
    purchasesGrouped: [{
      description: 'Test purchase',
      category: 'Purchase category',
      personName: 'Person 01',
      cardName: 'Test card',
      purchaseDate: null,
      totalAmount: 10,
      totalInstallments: 2,
      installments: [
        { month: 1, year: 2027, amount: 5 },
        { month: 2, year: 2027, amount: 5 },
      ],
    }],
    monthlyBudgets: [{
      person: 'Person 01',
      year: 2027,
      section: 'moradia',
      label: 'Rent',
      months: Array.from({ length: 12 }, (_, index) => ({
        month: index + 1,
        amount: index === 0 ? parseMoney('2.65') : 0,
      })),
    }],
    birthdays: [],
  };
  const userId = String(account.user._id);

  const summary = await executeSpreadsheetImport(userId, analyzedData);

  assert.deepEqual(summary, {
    peopleUpserted: 1,
    cardsUpserted: 1,
    purchasesUpserted: 1,
    installmentsUpserted: 2,
    budgetsUpserted: 1,
    birthdaysUpserted: 0,
  });
  assert.equal((await Card.findOne({ userId, name: 'Test card' }).lean()).limit, 1500);
  assert.equal(await Purchase.countDocuments({ userId }), 1);
  assert.equal(await Installment.countDocuments({ userId }), 2);
  const importedPerson = await Person.findOne({ userId, name: 'Person 01' });
  const sheet = await createBudgetsService().getSheet(userId, String(importedPerson._id), 2027);
  assert.equal(sheet.sections.find((section) => section.key === 'housing').rows.find((row) => row.label === 'Rent').values[0], 2.65);

  const repeat = await executeSpreadsheetImport(userId, analyzedData);
  assert.equal(repeat.peopleUpserted, 0);
  assert.equal(repeat.cardsUpserted, 0);
  assert.equal(repeat.purchasesUpserted, 0);
  assert.equal(repeat.installmentsUpserted, 0);
  assert.equal(await Purchase.countDocuments({ userId }), 1);
  assert.equal(await Installment.countDocuments({ userId }), 2);
});
