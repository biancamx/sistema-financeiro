import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearMongoMemory, createApiClient, createTestAccount, startMongoMemory } from './helpers/mongo.js';
import { Card } from '../src/models/Card.js';
import { Installment } from '../src/models/Installment.js';
import { Person } from '../src/models/Person.js';
import { Purchase } from '../src/models/Purchase.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-budget-payments';
process.env.ENABLE_LOCAL_LOGIN = 'true';
process.env.RATE_LIMIT_MAX = '100000';
process.env.AUTH_RATE_LIMIT_MAX = '100000';

const { createApp } = await import('../src/app.js');
let server;
let baseUrl;
let stopMongo;

before(async () => {
  stopMongo = await startMongoMemory();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

beforeEach(clearMongoMemory);

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (stopMongo) await stopMongo();
});

test('marca despesa manual como paga apenas no mês selecionado', async () => {
  const account = await createTestAccount({ email: 'budget-payments@example.invalid' });
  const api = createApiClient(baseUrl, account.cookie);
  const personId = String(account.person._id);
  const getSheet = async () => api('GET', `/budgets?personId=${personId}&year=2026&month=8`);

  const initial = await getSheet();
  const water = initial.json.data.sections.find((section) => section.key === 'housing').rows.find((row) => row.label === 'Água');
  assert.deepEqual(water.paidMonths, Array(12).fill(false));

  const savedJulyValue = await api('PUT', `/budgets/rows/${water.id}/cells/7`, { value: 80 });
  assert.equal(savedJulyValue.status, 200, savedJulyValue.text);
  const markedJuly = await api('PATCH', `/budgets/rows/${water.id}/cells/7/paid`, { paid: true });
  assert.equal(markedJuly.status, 200, markedJuly.text);

  const savedValue = await api('PUT', `/budgets/rows/${water.id}/cells/8`, { value: 120 });
  assert.equal(savedValue.status, 200, savedValue.text);
  const marked = await api('PATCH', `/budgets/rows/${water.id}/cells/8/paid`, { paid: true });
  assert.equal(marked.status, 200, marked.text);
  const afterMarking = await getSheet();
  const updatedWater = afterMarking.json.data.sections.find((section) => section.key === 'housing').rows.find((row) => row.id === water.id);
  assert.equal(updatedWater.values[7], 120);
  assert.equal(updatedWater.paidMonths[7], true);
  assert.equal(updatedWater.paidMonths[6], true);

  const changedValue = await api('PUT', `/budgets/rows/${water.id}/cells/8`, { value: 125 });
  assert.equal(changedValue.status, 200, changedValue.text);
  const afterChangingAmount = await getSheet();
  const changedWater = afterChangingAmount.json.data.sections.find((section) => section.key === 'housing').rows.find((row) => row.id === water.id);
  assert.equal(changedWater.values[7], 125);
  assert.equal(changedWater.paidMonths[7], false);
  assert.equal(changedWater.paidMonths[6], true);

  const income = initial.json.data.sections.find((section) => section.key === 'income').rows[0];
  assert.equal((await api('PATCH', `/budgets/rows/${income.id}/cells/8/paid`, { paid: true })).status, 400);
});

test('planilha e compras mensais usam o mês de vencimento da fatura', async () => {
  const account = await createTestAccount({ email: 'budget-card-due-month@example.invalid' });
  const api = createApiClient(baseUrl, account.cookie);
  const personId = String(account.person._id);
  const otherPerson = await Person.create({ userId: account.user._id, name: 'Outra pessoa' });
  const group = 'shared-card-due-month-test';
  await Card.updateOne({ _id: account.card._id }, { $set: { closingDay: 29, dueDay: 5 } });

  const purchases = await Purchase.create([
    {
      userId: account.user._id, personId: account.person._id, cardId: account.card._id,
      description: 'Compra compartilhada', purchaseDate: '2026-11-12',
      totalAmount: 50, totalInstallments: 2, splitGroupId: group,
    },
    {
      userId: account.user._id, personId: otherPerson._id, cardId: account.card._id,
      description: 'Compra compartilhada', purchaseDate: '2026-11-12',
      totalAmount: 50, totalInstallments: 2, splitGroupId: group,
    },
  ]);
  await Installment.create(purchases.flatMap((purchase) => [
    {
      userId: account.user._id, purchaseId: purchase._id,
      number: 1, year: 2026, month: 11, amount: 25,
    },
    {
      userId: account.user._id, purchaseId: purchase._id,
      number: 2, year: 2026, month: 12, amount: 25,
    },
  ]));

  const purchasesList = await api('GET', '/purchases?page=1&pageSize=10');
  assert.equal(purchasesList.status, 200, purchasesList.text);
  assert.deepEqual(purchasesList.json.data[0].firstDue, { year: 2026, month: 12 });
  assert.deepEqual(purchasesList.json.data[0].lastDue, { year: 2027, month: 1 });

  const decemberInstallments = await api('GET', '/purchases/installments?month=12&year=2026');
  assert.equal(decemberInstallments.status, 200, decemberInstallments.text);
  assert.equal(decemberInstallments.json.data.length, 2);
  assert.ok(decemberInstallments.json.data.every((item) => item.number === 1));

  const decemberSheet = await api('GET', `/budgets?personId=${personId}&year=2026&month=12`);
  assert.equal(decemberSheet.status, 200, decemberSheet.text);
  const decemberCards = decemberSheet.json.data.sections.find((section) => section.key === 'cards');
  assert.equal(decemberCards.rows[0].values[10], 0);
  assert.equal(decemberCards.rows[0].values[11], 25);
  assert.equal(decemberSheet.json.data.monthly.purchases.length, 1);
  assert.equal(decemberSheet.json.data.monthly.purchases[0].amount, 25);

  const januarySheet = await api('GET', `/budgets?personId=${personId}&year=2027&month=1`);
  assert.equal(januarySheet.status, 200, januarySheet.text);
  const januaryCards = januarySheet.json.data.sections.find((section) => section.key === 'cards');
  assert.equal(januaryCards.rows[0].values[0], 25);
  assert.equal(januarySheet.json.data.monthly.purchases.length, 1);
  assert.equal(januarySheet.json.data.monthly.purchases[0].amount, 25);

  const markDecemberPaid = await api('POST', '/purchases/installments/month-status', {
    personId, month: 12, year: 2026, paid: true,
  });
  assert.equal(markDecemberPaid.status, 200, markDecemberPaid.text);
  assert.equal(markDecemberPaid.json.data.updated, 1);
  const personInstallments = await Installment.find({ purchaseId: purchases[0]._id }).sort({ number: 1 }).lean();
  assert.deepEqual(personInstallments.map(({ month, paid }) => [month, paid]), [[11, true], [12, false]]);
});
