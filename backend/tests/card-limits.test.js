import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearMongoMemory, createApiClient, createTestAccount, startMongoMemory } from './helpers/mongo.js';
import { Person } from '../src/models/Person.js';
import { Card } from '../src/models/Card.js';
import { Purchase } from '../src/models/Purchase.js';
import { Installment } from '../src/models/Installment.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-card-limits';
process.env.ENABLE_LOCAL_LOGIN = 'true';
process.env.RATE_LIMIT_MAX = '100000';
process.env.AUTH_RATE_LIMIT_MAX = '100000';

const { createApp } = await import('../src/app.js');
let stopMongo;
let server;
let baseUrl;

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

test('limite e faturas refletem parcelas em aberto imediatamente em cartões, painel e visão geral', async () => {
  const account = await createTestAccount({ email: 'card-limits@example.invalid', limit: 50 });
  const person = account.person;
  const secondPerson = await Person.create({
    userId: account.user._id,
    name: 'Participant',
  });
  const secondCard = await Card.create({
    userId: account.user._id,
    name: 'Card B',
    limit: 100,
  });
  const purchases = await Purchase.create([
    {
      userId: account.user._id, description: 'Old installment', personId: person._id,
      cardId: account.card._id, totalAmount: 90, totalInstallments: 1,
    },
    {
      userId: account.user._id, description: 'Partial installment', personId: person._id,
      cardId: account.card._id, totalAmount: 25.25, totalInstallments: 1,
    },
    {
      userId: account.user._id, description: 'Future installment', personId: person._id,
      cardId: account.card._id, totalAmount: 60.6, totalInstallments: 1,
    },
    {
      userId: account.user._id, description: 'Other card', personId: secondPerson._id,
      cardId: secondCard._id, totalAmount: 30.3, totalInstallments: 1,
    },
    {
      userId: account.user._id, description: 'Paid installment', personId: secondPerson._id,
      cardId: secondCard._id, totalAmount: 5, totalInstallments: 1,
    },
  ]);
  const [old, partial, future, other, paid] = purchases;
  const installments = await Installment.create([
    { userId: account.user._id, purchaseId: old._id, number: 1, year: 2026, month: 9, amount: 90 },
    { userId: account.user._id, purchaseId: partial._id, number: 1, year: 2026, month: 10, amount: 25.25, paidAmount: 5.05 },
    { userId: account.user._id, purchaseId: future._id, number: 1, year: 2026, month: 11, amount: 60.6 },
    { userId: account.user._id, purchaseId: other._id, number: 1, year: 2026, month: 10, amount: 30.3 },
    { userId: account.user._id, purchaseId: paid._id, number: 1, year: 2026, month: 10, amount: 5, paid: true },
  ]);
  const api = createApiClient(baseUrl, account.cookie);
  const cardAId = String(account.card._id);
  const cardBId = String(secondCard._id);
  const [currentA, futureA, currentB] = [installments[1], installments[2], installments[3]].map((item) => String(item._id));
  const getCards = async () => (await api('GET', '/cards?month=10&year=2026')).json.data;
  const getDashboard = async () => (await api('GET', `/dashboard/summary?month=10&year=2026&personId=${person._id}`)).json.data;

  const initialCards = await getCards();
  const initialCardValues = new Map(initialCards.map((card) => [card.id, [card.used, card.available, card.invoice]]));
  assert.deepEqual(
    [initialCardValues.get(cardAId), initialCardValues.get(cardBId)],
    [[60.6, -10.6, 20.2], [0, 100, 30.3]],
  );
  const initialDashboard = await getDashboard();
  assert.equal(initialDashboard.totals.month, 50.5);
  assert.equal(initialDashboard.totals.owed, 111.1);
  assert.equal(initialDashboard.cardTotals.find((card) => card.id === cardAId).used, 60.6);
  assert.equal(initialDashboard.cardTotals.find((card) => card.id === cardAId).available, -10.6);
  assert.equal(initialDashboard.person.cards.find((card) => card.id === cardAId).amount, 20.2);

  const overview = (await api('GET', `/dashboard/person-overview?personId=${person._id}&year=2026`)).json.data;
  assert.equal(overview.cards.find((card) => card.id === cardAId).values[9], 20.2);
  assert.equal(overview.cards.find((card) => card.id === cardAId).values[8], 90);

  assert.equal((await api('PATCH', `/purchases/installments/${currentA}`, { paid: true })).status, 200);
  assert.equal((await getCards()).find((card) => card.id === cardAId).used, 60.6);
  assert.equal((await getCards()).find((card) => card.id === cardAId).invoice, 0);
  assert.equal((await getDashboard()).totals.month, 30.3);
  assert.equal((await getDashboard()).totals.owed, 90.9);

  assert.equal((await api('PATCH', `/purchases/installments/${currentA}`, { paid: false })).status, 200);
  assert.equal((await getCards()).find((card) => card.id === cardAId).used, 60.6);
  assert.equal((await api('PATCH', `/purchases/installments/${currentA}`, { paid: true })).status, 200);
  assert.equal((await getCards()).find((card) => card.id === cardAId).used, 60.6);

  assert.equal((await api('POST', '/purchases/installments/pay-selected', { ids: [futureA, currentB] })).status, 200);
  assert.equal((await getCards()).find((card) => card.id === cardAId).used, 0);
  assert.equal((await getCards()).find((card) => card.id === cardBId).used, 0);
  assert.equal((await getDashboard()).totals.owed, 0);
  const overviewAfterBulk = (await api('GET', `/dashboard/person-overview?personId=${person._id}&year=2026`)).json.data;
  assert.equal(overviewAfterBulk.cards.find((card) => card.id === cardAId).values[10], 0);

  assert.equal((await api('POST', '/purchases/installments/unpay-selected', { ids: [currentA, futureA, currentB] })).status, 200);
  assert.equal((await getCards()).find((card) => card.id === cardAId).used, 60.6);
  assert.equal((await getCards()).find((card) => card.id === cardBId).used, 0);
});

test('compras preservam observações, compartilhamento e recálculo após alteração do fechamento', async () => {
  const account = await createTestAccount({ email: 'purchase-behavior@example.invalid' });
  const secondPerson = await Person.create({ userId: account.user._id, name: 'Second participant' });
  const api = createApiClient(baseUrl, account.cookie);
  const personId = String(account.person._id);
  const cardId = String(account.card._id);
  const body = {
    description: 'Purchase created by API',
    categoryId: null,
    observation: 'Receipt saved',
    personId,
    cardId,
    total: 10,
    count: 1,
    startMonth: 10,
    startYear: 2026,
  };
  const created = await api('POST', '/purchases', body);
  assert.equal(created.status, 201, created.text);
  assert.equal(created.json.data.observation, 'Receipt saved');
  const sheet = await api('GET', `/budgets?personId=${personId}&year=2026&month=10`);
  assert.equal(
    sheet.json.data.monthly.purchases.find((purchase) => purchase.purchaseId === created.json.data.id).observation,
    'Receipt saved',
  );
  assert.equal(
    (await api('PATCH', `/purchases/${created.json.data.id}/observation`, { observation: 'Updated receipt' })).status,
    200,
  );

  const shared = await api('POST', '/purchases/shared', {
    description: 'Shared purchase',
    observation: 'Shared warranty',
    categoryId: null,
    cardId,
    total: 20,
    count: 1,
    startMonth: 12,
    startYear: 2026,
    splitMode: 'equal',
    participants: [{ personId }, { personId: String(secondPerson._id) }],
  });
  assert.equal(shared.status, 201, shared.text);
  assert.equal(shared.json.data.observation, 'Shared warranty');
  const participantPurchaseId = shared.json.data.participants[0].purchaseId;
  assert.equal(
    (await api('PATCH', `/purchases/${participantPurchaseId}/observation`, { observation: 'Shared receipt' })).status,
    200,
  );
  const sharedAfterUpdate = await api('GET', `/purchases/shared/${shared.json.data.group}`);
  assert.equal(sharedAfterUpdate.json.data.observation, 'Shared receipt');

  const now = new Date();
  const purchaseDate = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 10));
  const purchaseMonth = purchaseDate.getUTCMonth() + 1;
  const purchaseYear = purchaseDate.getUTCFullYear();
  const nextStatementMonth = purchaseMonth === 12 ? 1 : purchaseMonth + 1;
  const nextStatementYear = purchaseMonth === 12 ? purchaseYear + 1 : purchaseYear;
  const date = `${purchaseYear}-${String(purchaseMonth).padStart(2, '0')}-10`;
  const recalculationCard = await api('POST', '/cards', {
    name: 'Recalculation card', limit: 500, closingDay: 10, dueDay: 5,
  });
  assert.equal(recalculationCard.status, 201);
  const rescheduledPurchase = await api('POST', '/purchases', {
    description: 'Purchase after closing day',
    personId,
    cardId: recalculationCard.json.data.id,
    purchaseDate: date,
    total: 80,
    count: 1,
    startMonth: nextStatementMonth,
    startYear: nextStatementYear,
  });
  assert.equal(rescheduledPurchase.status, 201, rescheduledPurchase.text);
  assert.equal(rescheduledPurchase.json.data.first.month, nextStatementMonth);
  const updatedCard = await api('PUT', `/cards/${recalculationCard.json.data.id}`, {
    ...recalculationCard.json.data,
    closingDay: 11,
  });
  assert.equal(updatedCard.status, 200, updatedCard.text);
  const recalculated = await api('GET', `/purchases/${rescheduledPurchase.json.data.id}`);
  assert.equal(recalculated.json.data.first.month, purchaseMonth);
});
