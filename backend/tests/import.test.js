import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { clearMongoMemory, createTestAccount, startMongoMemory } from './helpers/mongo.js';
import { Person } from '../src/models/Person.js';
import { Card } from '../src/models/Card.js';
import { Purchase } from '../src/models/Purchase.js';
import { Installment } from '../src/models/Installment.js';
import { processSpreadsheetImport } from '../src/modules/import/import.service.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-import';

let stopMongo;

before(async () => {
  stopMongo = await startMongoMemory();
});

beforeEach(clearMongoMemory);

after(async () => {
  if (stopMongo) await stopMongo();
});

function makeWorkbook(rows) {
  const workbook = XLSX.utils.book_new();
  const headers = [
    'Detalhe da compra', 'Descrição', 'Pessoa', 'Valor Total', 'Qtd. Parcelas',
    'Valor da Parcela', 'Mês', 'Ano', 'Cartão',
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'Banco De Dados');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

test('importação cria entidades e parcelas da planilha no MongoDB', async () => {
  const account = await createTestAccount({ email: 'import@example.invalid' });
  const fileBuffer = makeWorkbook([[
    'Test purchase', 'Test category', 'Imported person', 42.5, 1, 42.5, 'Janeiro', 2026, 'Imported card',
  ]]);

  const result = await processSpreadsheetImport(String(account.user._id), fileBuffer);

  assert.equal(result.peopleUpserted, 1);
  assert.equal(result.cardsUpserted, 1);
  assert.equal(result.purchasesUpserted, 1);
  assert.equal(result.installmentsUpserted, 1);
  const [person] = await Person.find({ userId: account.user._id, name: 'Imported person' }).lean();
  const [card] = await Card.find({ userId: account.user._id, name: 'Imported card' }).lean();
  const [purchase] = await Purchase.find({ userId: account.user._id }).lean();
  const [installment] = await Installment.find({ userId: account.user._id }).lean();
  assert.equal(purchase.totalAmount, 42.5);
  assert.equal(purchase.totalInstallments, 1);
  assert.equal(String(purchase.personId), String(person._id));
  assert.equal(String(purchase.cardId), String(card._id));
  assert.deepEqual(
    { number: installment.number, month: installment.month, year: installment.year, amount: installment.amount },
    { number: 1, month: 1, year: 2026, amount: 42.5 },
  );
});

test('substituição remove compras antigas do usuário e importa a nova planilha', async () => {
  const account = await createTestAccount({ email: 'replace@example.invalid' });
  const oldPerson = await Person.create({ userId: account.user._id, name: 'Old purchase person' });
  const oldCard = await Card.create({ userId: account.user._id, name: 'Old card' });
  const oldPurchase = await Purchase.create({
    userId: account.user._id, personId: oldPerson._id, cardId: oldCard._id,
    description: 'Old record', totalAmount: 10, totalInstallments: 1,
  });
  await Installment.create({
    userId: account.user._id, purchaseId: oldPurchase._id,
    number: 1, year: 2026, month: 1, amount: 10,
  });
  const fileBuffer = makeWorkbook([[
    'New purchase', 'New category', 'New person', 20, 1, 20, 'Janeiro', 2026, 'New card',
  ]]);

  const result = await processSpreadsheetImport(String(account.user._id), fileBuffer, { replaceExisting: true });

  assert.equal(await Purchase.countDocuments({ userId: account.user._id }), 1);
  assert.equal(await Installment.countDocuments({ userId: account.user._id }), 1);
  assert.equal((await Purchase.findOne({ userId: account.user._id }).lean()).description, 'New purchase');
  assert.equal(result.purchasesUpserted, 1);
});

test('importa parcelas agrupadas e preserva detalhe, categoria e valores calculados', async () => {
  const account = await createTestAccount({ email: 'grouped-import@example.invalid' });
  const rows = [];
  for (const [person, total, amount] of [['Person 01', 120, 30], ['Person 02', 80, 20]]) {
    for (let month = 1; month <= 4; month++) {
      rows.push([
        'Demonstration item',
        'Test category',
        person,
        total,
        4,
        amount,
        new Date(2026, month - 1).toLocaleString('pt-BR', { month: 'long' }),
        2026,
        'Demonstration card',
      ]);
    }
  }
  rows.push(['', 'Total', '', '', '', '', 'Total', '', '']);

  const result = await processSpreadsheetImport(String(account.user._id), makeWorkbook(rows));

  assert.equal(result.peopleUpserted, 2);
  assert.equal(result.cardsUpserted, 1);
  assert.equal(result.purchasesUpserted, 2);
  assert.equal(result.installmentsUpserted, 8);
  const purchases = await Purchase.find({ userId: account.user._id })
    .populate('personId', 'name')
    .populate('categoryId', 'name')
    .sort({ 'personId.name': 1 })
    .lean();
  assert.deepEqual(purchases.map((purchase) => ({
    description: purchase.description,
    totalAmount: purchase.totalAmount,
    totalInstallments: purchase.totalInstallments,
    person: purchase.personId.name,
    category: purchase.categoryId?.name,
  })), [
    { description: 'Demonstration item', totalAmount: 120, totalInstallments: 4, person: 'Person 01', category: 'Test category' },
    { description: 'Demonstration item', totalAmount: 80, totalInstallments: 4, person: 'Person 02', category: 'Test category' },
  ]);
  const installments = await Installment.find({ userId: account.user._id }).sort({ month: 1 }).lean();
  assert.equal(installments.length, 8);
  for (const person of ['Person 01', 'Person 02']) {
    const purchase = purchases.find((item) => item.personId.name === person);
    const rowsForPerson = installments.filter((item) => String(item.purchaseId) === String(purchase._id));
    assert.deepEqual(rowsForPerson.map((item) => item.number), [1, 2, 3, 4]);
    assert.deepEqual(rowsForPerson.map((item) => item.month), [1, 2, 3, 4]);
    assert.ok(rowsForPerson.every((item) => item.year === 2026));
    assert.ok(rowsForPerson.every((item) => item.amount === (person === 'Person 01' ? 30 : 20)));
  }
});

test('importa linhas recorrentes como assinaturas com término reconhecido', async () => {
  const account = await createTestAccount({ email: 'spreadsheet-subscription@example.invalid' });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Compra', 'Responsável', 'Valor mensal', 'Início', 'Fim'],
    ['Streaming', 'Subscription person', 'R$ 9,99', 'mar/2026', 'mai/2026'],
  ]), 'Recorrentes');
  const fileBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  const result = await processSpreadsheetImport(String(account.user._id), fileBuffer);

  assert.equal(result.purchasesUpserted, 1);
  assert.equal(result.installmentsUpserted, 1);
  const [purchase] = await Purchase.find({ userId: account.user._id }).lean();
  const [installment] = await Installment.find({ userId: account.user._id }).lean();
  assert.equal(purchase.isSubscription, true);
  assert.equal(purchase.totalAmount, 9.99);
  assert.equal(purchase.totalInstallments, 1);
  assert.equal(new Date(purchase.subscriptionEndAt).toISOString(), '2026-05-31T00:00:00.000Z');
  assert.deepEqual(
    { month: installment.month, year: installment.year, amount: installment.amount },
    { month: 3, year: 2026, amount: 9.99 },
  );
});
