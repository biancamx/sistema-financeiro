import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearMongoMemory, startMongoMemory } from './helpers/mongo.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-bulk-payments';
process.env.ENABLE_LOCAL_LOGIN = 'true';
process.env.RATE_LIMIT_MAX = '100000';
process.env.AUTH_RATE_LIMIT_MAX = '100000';

const [
  { createApp },
  { User },
  { Person },
  { Card },
  { Purchase },
  { Installment },
  { createPurchasesService },
  { generateToken },
] = await Promise.all([
  import('../src/app.js'),
  import('../src/models/User.js'),
  import('../src/models/Person.js'),
  import('../src/models/Card.js'),
  import('../src/models/Purchase.js'),
  import('../src/models/Installment.js'),
  import('../src/modules/purchases/purchases.service.js'),
  import('../src/modules/auth/auth.service.js'),
]);

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

async function createAccount(email) {
  const user = await User.create({ name: email, email, status: 'active' });
  const person = await Person.create({ userId: user._id, name: 'Person' });
  const card = await Card.create({ userId: user._id, name: 'Card', limit: 1000 });
  return { user, person, card, cookie: `caderno_token=${generateToken(user)}` };
}

function installmentsFor(user, purchase, startMonth = 10) {
  return Array.from({ length: 2 }, (_, index) => ({
    userId: user._id,
    purchaseId: purchase._id,
    number: index + 1,
    year: 2099,
    month: startMonth + index,
    amount: 100,
  }));
}

test('bulk payment enforces user isolation and updates only owned installments', async () => {
  const owner = await createAccount('bulk-owner@example.invalid');
  const other = await createAccount('bulk-other@example.invalid');
  const purchase = await Purchase.create({
    userId: owner.user._id,
    personId: owner.person._id,
    cardId: owner.card._id,
    description: 'Owner purchase',
    totalAmount: 200,
    totalInstallments: 2,
  });
  const otherPurchase = await Purchase.create({
    userId: other.user._id,
    personId: other.person._id,
    cardId: other.card._id,
    description: 'Other purchase',
    totalAmount: 200,
    totalInstallments: 2,
  });
  const [first, second] = await Installment.create(installmentsFor(owner.user, purchase));
  const [foreign] = await Installment.create(installmentsFor(other.user, otherPurchase));
  first.paidAmount = 25;
  await first.save();

  const service = createPurchasesService();
  await assert.rejects(
    service.setManyPaid(owner.user._id, [first._id, foreign._id]),
    (error) => error.status === 404,
  );
  const unchanged = await Installment.findById(first._id).lean();
  assert.equal(unchanged.paid, false);
  assert.equal(unchanged.paidAmount, 25);

  assert.deepEqual(await service.setManyPaid(owner.user._id, [first._id, second._id]), { updated: 2 });
  const paid = await Installment.find({ purchaseId: purchase._id }).sort({ number: 1 }).lean();
  assert.deepEqual(paid.map(({ paid, paidAmount }) => [paid, paidAmount]), [[true, 100], [true, 100]]);

  assert.deepEqual(await service.setManyPaid(owner.user._id, [first._id, second._id], false), { updated: 2 });
  const unpaid = await Installment.find({ purchaseId: purchase._id }).sort({ number: 1 }).lean();
  assert.deepEqual(unpaid.map(({ paid, paidAmount }) => [paid, paidAmount]), [[false, 0], [false, 0]]);
  assert.equal((await Installment.findById(foreign._id).lean()).paid, false);
});

test('bulk payment API requires a session and restores available card limit', async () => {
  const owner = await createAccount('bulk-api@example.invalid');
  const purchase = await Purchase.create({
    userId: owner.user._id,
    personId: owner.person._id,
    cardId: owner.card._id,
    description: 'API purchase',
    totalAmount: 200,
    totalInstallments: 2,
  });
  const installments = await Installment.create(installmentsFor(owner.user, purchase));
  const ids = installments.map(({ _id }) => String(_id));
  const endpoint = `${baseUrl}/purchases/installments/pay-selected`;

  const anonymous = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  assert.equal(anonymous.status, 401);

  const headers = { 'Content-Type': 'application/json', Cookie: owner.cookie };
  const before = await fetch(`${baseUrl}/cards?month=10&year=2099`, { headers }).then((response) => response.json());
  assert.equal(before.data.find((card) => card.id === String(owner.card._id)).used, 200);

  const paid = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ ids }) });
  assert.equal(paid.status, 200);
  assert.deepEqual((await paid.json()).data, { updated: 2 });

  const afterPayment = await fetch(`${baseUrl}/cards?month=10&year=2099`, { headers }).then((response) => response.json());
  const released = afterPayment.data.find((card) => card.id === String(owner.card._id));
  assert.equal(released.used, 0);
  assert.equal(released.available, 1000);

  const unpaid = await fetch(`${baseUrl}/purchases/installments/unpay-selected`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ids }),
  });
  assert.equal(unpaid.status, 200);
  const afterUnpay = await fetch(`${baseUrl}/cards?month=10&year=2099`, { headers }).then((response) => response.json());
  const restored = afterUnpay.data.find((card) => card.id === String(owner.card._id));
  assert.equal(restored.used, 200);
  assert.equal(restored.available, 800);
});

test('month payment only changes card installments for the selected person and month', async () => {
  const owner = await createAccount('bulk-month@example.invalid');
  const otherPerson = await Person.create({ userId: owner.user._id, name: 'Other person' });
  const purchase = await Purchase.create({
    userId: owner.user._id, personId: owner.person._id, cardId: owner.card._id,
    description: 'Selected month', totalAmount: 200, totalInstallments: 2,
  });
  const otherMonthPurchase = await Purchase.create({
    userId: owner.user._id, personId: owner.person._id, cardId: owner.card._id,
    description: 'Other month', totalAmount: 100, totalInstallments: 1,
  });
  const secondSelectedMonthPurchase = await Purchase.create({
    userId: owner.user._id, personId: owner.person._id, cardId: owner.card._id,
    description: 'Another selected month charge', totalAmount: 100, totalInstallments: 1,
  });
  const otherPersonPurchase = await Purchase.create({
    userId: owner.user._id, personId: otherPerson._id, cardId: owner.card._id,
    description: 'Other person', totalAmount: 100, totalInstallments: 1,
  });
  const [selected, secondSelected, otherMonth, otherPersonInstallment] = await Installment.create([
    { ...installmentsFor(owner.user, purchase, 10)[0], year: 2099 },
    { ...installmentsFor(owner.user, secondSelectedMonthPurchase, 10)[0], year: 2099 },
    { ...installmentsFor(owner.user, otherMonthPurchase, 11)[0], year: 2099 },
    { ...installmentsFor(owner.user, otherPersonPurchase, 10)[0], year: 2099 },
  ]);
  const endpoint = `${baseUrl}/purchases/installments/month-status`;
  const headers = { 'Content-Type': 'application/json', Cookie: owner.cookie };
  const request = (paid) => fetch(endpoint, {
    method: 'POST', headers,
    body: JSON.stringify({ personId: String(owner.person._id), month: 10, year: 2099, paid }),
  });
  const budgetUrl = `${baseUrl}/budgets?personId=${owner.person._id}&year=2099&month=10`;
  const statusBefore = await fetch(budgetUrl, { headers }).then((response) => response.json());
  assert.deepEqual(statusBefore.data.cardPaymentStatuses[9], { hasCharges: true, paid: false });
  const cardUsed = async () => {
    const response = await fetch(`${baseUrl}/cards?month=10&year=2099`, { headers }).then((result) => result.json());
    return response.data.find((card) => card.id === String(owner.card._id)).used;
  };
  assert.equal(await cardUsed(), 400);

  const paid = await request(true);
  assert.equal(paid.status, 200);
  assert.deepEqual((await paid.json()).data, { updated: 2 });
  assert.equal(await cardUsed(), 200);
  const statusAfterPay = await fetch(budgetUrl, { headers }).then((response) => response.json());
  assert.deepEqual(statusAfterPay.data.cardPaymentStatuses[9], { hasCharges: true, paid: true });
  assert.deepEqual(
    await Promise.all([selected, secondSelected, otherMonth, otherPersonInstallment].map(async (item) => {
      const current = await Installment.findById(item._id).lean();
      return [current.paid, current.paidAmount];
    })),
    [[true, 100], [true, 100], [false, 0], [false, 0]],
  );

  const unmarked = await request(false);
  assert.equal(unmarked.status, 200);
  assert.deepEqual((await unmarked.json()).data, { updated: 2 });
  assert.equal(await cardUsed(), 400);
  const reset = await Installment.findById(selected._id).lean();
  assert.deepEqual([reset.paid, reset.paidAmount], [false, 0]);
  const statusAfterUnpay = await fetch(budgetUrl, { headers }).then((response) => response.json());
  assert.deepEqual(statusAfterUnpay.data.cardPaymentStatuses[9], { hasCharges: true, paid: false });
});
