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

test('cartões no mesmo grupo compartilham limite sem misturar faturas e pagamentos', async () => {
  const account = await createTestAccount({ email: 'shared-limit@teste.invalid', limit: 5000 });
  const api = createApiClient(baseUrl, account.cookie);
  const groupResponse = await api('POST', '/cards/limit-groups', {
    name: 'Ourocard', institution: 'Banco do Brasil', limit: 10000,
  });
  assert.equal(groupResponse.status, 201, groupResponse.text);
  const group = groupResponse.json.data;

  const visa = await api('PUT', `/cards/${account.card._id}`, {
    name: 'Visa', issuer: 'Banco do Brasil', brand: 'Visa', limit: 5000,
    closingDay: 10, closingDayEqual: 'next', dueDay: 17,
  });
  assert.equal(visa.status, 200, visa.text);
  const mastercard = await api('POST', '/cards', {
    name: 'Mastercard', issuer: 'Banco do Brasil', brand: 'Mastercard', limit: 4000,
    closingDay: 20, closingDayEqual: 'next', dueDay: 27,
  });
  assert.equal(mastercard.status, 201, mastercard.text);
  const mastercardId = mastercard.json.data.id;
  const createPurchase = (body) => api('POST', '/purchases', {
    personId: String(account.person._id), categoryId: null, startMonth: 10, startYear: 2099, ...body,
  });
  const visaPurchase = await createPurchase({
    description: 'Parcelada no Visa', cardId: String(account.card._id), purchaseDate: '2099-10-12', total: 1200, count: 6,
  });
  assert.equal(visaPurchase.status, 201, visaPurchase.text);
  const mastercardPurchase = await createPurchase({
    description: 'Compra no Mastercard', cardId: mastercardId, purchaseDate: '2099-10-12', total: 600, count: 1,
  });
  assert.equal(mastercardPurchase.status, 201, mastercardPurchase.text);

  const linkedVisa = await api('PUT', `/cards/${account.card._id}`, {
    name: 'Visa', issuer: 'Banco do Brasil', brand: 'Visa', limitGroupId: group.id,
    closingDay: 10, closingDayEqual: 'next', dueDay: 17,
  });
  assert.equal(linkedVisa.status, 200, linkedVisa.text);
  const linkedMastercard = await api('PUT', `/cards/${mastercardId}`, {
    name: 'Mastercard', issuer: 'Banco do Brasil', brand: 'Mastercard',
    limitGroupId: group.id, closingDay: 20, closingDayEqual: 'next', dueDay: 27,
  });
  assert.equal(linkedMastercard.status, 200, linkedMastercard.text);
  const elo = await api('POST', '/cards', {
    name: 'Elo', issuer: 'Banco do Brasil', brand: 'Elo', limitGroupId: group.id,
    closingDay: 15, closingDayEqual: 'next', dueDay: 22,
  });
  assert.equal(elo.status, 201, elo.text);

  const getCards = async (month) => (await api('GET', `/cards?month=${month}&year=2099`)).json.data;
  let octoberCards = await getCards(10);
  let visaCard = octoberCards.find((card) => card.id === String(account.card._id));
  let mastercardCard = octoberCards.find((card) => card.id === mastercardId);
  assert.equal(visaCard.invoice, 0);
  assert.equal(mastercardCard.invoice, 600);
  assert.equal(visaCard.used, 1800);
  assert.equal(mastercardCard.used, 1800);
  assert.equal(visaCard.limit, 10000);
  assert.equal(mastercardCard.available, 8200);

  const novemberCards = await getCards(11);
  visaCard = novemberCards.find((card) => card.id === String(account.card._id));
  mastercardCard = novemberCards.find((card) => card.id === mastercardId);
  assert.equal(visaCard.invoice, 200);
  assert.equal(visaCard.invoiceDueDate, '2099-11-17');
  assert.equal(mastercardCard.invoice, 0);
  assert.equal(mastercardCard.invoiceDueDate, '2099-11-27');

  const partialPayment = await api('POST', `/cards/${mastercardId}/payments`, { month: 10, year: 2099, amount: 300 });
  assert.equal(partialPayment.status, 200, partialPayment.text);
  octoberCards = await getCards(10);
  visaCard = octoberCards.find((card) => card.id === String(account.card._id));
  mastercardCard = octoberCards.find((card) => card.id === mastercardId);
  assert.equal(visaCard.used, 1500);
  assert.equal(mastercardCard.used, 1500);
  assert.equal(mastercardCard.invoice, 300);
  assert.equal(visaCard.invoice, 0);

  const mastercardDetails = await api('GET', `/purchases/${mastercardPurchase.json.data.id}`);
  assert.equal(mastercardDetails.status, 200, mastercardDetails.text);
  const reversedPayment = await api('PATCH', `/purchases/installments/${mastercardDetails.json.data.installments[0].id}`, { paid: false });
  assert.equal(reversedPayment.status, 200, reversedPayment.text);
  octoberCards = await getCards(10);
  assert.equal(octoberCards.find((card) => card.id === mastercardId).invoice, 600);
  assert.equal(octoberCards.find((card) => card.id === mastercardId).used, 1800);
  assert.equal((await api('POST', `/cards/${mastercardId}/payments`, { month: 10, year: 2099, amount: 300 })).status, 200);

  assert.equal((await api('POST', `/cards/${account.card._id}/payments`, { month: 11, year: 2099, amount: 200 })).status, 200);
  octoberCards = await getCards(10);
  visaCard = octoberCards.find((card) => card.id === String(account.card._id));
  mastercardCard = octoberCards.find((card) => card.id === mastercardId);
  assert.equal(visaCard.used, 1300);
  assert.equal(mastercardCard.used, 1300);
  assert.equal(mastercardCard.invoice, 300);
  const groupBalances = await api('GET', '/cards/limit-groups');
  assert.equal(groupBalances.json.data.find((item) => item.id === group.id).used, 1300);

  const updatedGroup = await api('PUT', `/cards/limit-groups/${group.id}`, {
    name: 'Ourocard', institution: 'Banco do Brasil', limit: 12000,
  });
  assert.equal(updatedGroup.status, 200, updatedGroup.text);
  const dashboard = await api('GET', '/dashboard/summary?month=10&year=2099');
  assert.equal(dashboard.status, 200, dashboard.text);
  assert.equal(dashboard.json.data.totals.limit, 12000);
  assert.equal(dashboard.json.data.totals.available, 10700);
  assert.equal(dashboard.json.data.cardTotals.find((card) => card.id === mastercardId).amount, 300);

  const canceledPurchase = await api('DELETE', `/purchases/${visaPurchase.json.data.id}`);
  assert.equal(canceledPurchase.status, 204, canceledPurchase.text);
  octoberCards = await getCards(10);
  visaCard = octoberCards.find((card) => card.id === String(account.card._id));
  mastercardCard = octoberCards.find((card) => card.id === mastercardId);
  assert.equal(visaCard.used, 300);
  assert.equal(mastercardCard.used, 300);
  assert.equal(mastercardCard.invoice, 300);

  const unlinked = await api('PUT', `/cards/${account.card._id}`, {
    name: 'Visa', issuer: 'Banco do Brasil', brand: 'Visa', limit: 5000, limitGroupId: null,
    closingDay: 10, closingDayEqual: 'next', dueDay: 17,
  });
  assert.equal(unlinked.status, 200, unlinked.text);
  const afterUnlink = await getCards(10);
  visaCard = afterUnlink.find((card) => card.id === String(account.card._id));
  mastercardCard = afterUnlink.find((card) => card.id === mastercardId);
  assert.equal(visaCard.used, 0);
  assert.equal(visaCard.limit, 5000);
  assert.equal(mastercardCard.used, 300);
  assert.equal(mastercardCard.limit, 12000);
});
