import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearMongoMemory, createApiClient, createTestAccount, startMongoMemory } from './helpers/mongo.js';
import { Category } from '../src/models/Category.js';
import { Person } from '../src/models/Person.js';
import { createCashLedgerService, generateCashSchedule } from '../src/modules/cashLedger/cashLedger.service.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-cash-ledger';
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

const today = () => new Date().toISOString().slice(0, 10);
const offsetDate = (days) => {
  const date = new Date(`${today()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

async function fixture(email = 'cash-ledger@example.invalid') {
  const account = await createTestAccount({ email });
  const secondPerson = await Person.create({ userId: account.user._id, name: 'Second person' });
  const category = await Category.create({ userId: account.user._id, name: 'Food' });
  return {
    person: account.person,
    secondPerson,
    category,
    userId: String(account.user._id),
    service: createCashLedgerService(),
  };
}

function sale(personId, changes = {}) {
  return {
    kind: 'sale',
    description: 'Demonstration vehicle',
    total: 8000,
    personId: String(personId),
    entryDate: today(),
    paymentMethod: 'pix',
    downPayment: 2000,
    installmentCount: 6,
    firstDueDate: offsetDate(30),
    frequency: 'monthly',
    notes: '',
    ...changes,
  };
}

test('cash schedule uses exact cents and clamps dates to month end', () => {
  assert.deepEqual(
    generateCashSchedule({ totalCents: 10000, count: 3, firstDueDate: '2026-10-10' }).map((item) => item.amountCents),
    [3334, 3333, 3333],
  );
  assert.deepEqual(
    generateCashSchedule({ totalCents: 300, count: 3, firstDueDate: '2026-01-31' }).map((item) => item.dueDate),
    ['2026-01-31', '2026-02-28', '2026-03-31'],
  );
  assert.deepEqual(
    generateCashSchedule({ totalCents: 300, count: 3, firstDueDate: '2026-10-21', frequency: 'weekly' }).map((item) => item.dueDate),
    ['2026-10-21', '2026-10-28', '2026-11-04'],
  );
});

test('cash ledger records expenses, sales, partial receipts, refunds and overdue installments', async () => {
  const { person, secondPerson, category, userId, service } = await fixture();
  const expense = await service.create(userId, {
    kind: 'expense',
    description: 'Coffee',
    total: 25,
    entryDate: today(),
    paymentMethod: 'pix',
    categoryId: String(category._id),
    notes: '',
  });
  assert.equal(expense.entry.kind, 'expense');
  assert.equal((await service.summary(userId, Number(today().slice(5, 7)), Number(today().slice(0, 4)))).spent, 25);

  const vehicleSale = await service.create(userId, sale(person._id));
  assert.equal(vehicleSale.installments.length, 7);
  assert.equal(vehicleSale.installments.reduce((sum, item) => sum + item.amountCents, 0), 800000);
  assert.equal(vehicleSale.installments[0].amountCents, 200000);
  assert.ok(vehicleSale.installments.slice(1).every((item) => item.amountCents === 100000));

  const downPayment = vehicleSale.installments[0];
  await service.receive(userId, downPayment.id, { amount: 2000, receivedOn: today(), paymentMethod: 'cash' });
  const secondInstallment = vehicleSale.installments[1];
  await service.receive(userId, secondInstallment.id, { amount: 400, receivedOn: today(), paymentMethod: 'pix' });
  let detail = await service.get(userId, vehicleSale.entry.id);
  const partial = detail.installments.find((item) => item.id === secondInstallment.id);
  assert.equal(partial.status, 'partial');
  assert.equal(partial.outstanding, 600);
  assert.equal(detail.receipts.length, 2);
  assert.equal((await service.summary(userId, Number(today().slice(5, 7)), Number(today().slice(0, 4)))).totalReceivable, 5600);
  const personSummary = await service.personSummary(userId, String(person._id));
  assert.equal(personSummary.total, 8000);
  assert.equal(personSummary.received, 2400);
  assert.equal(personSummary.outstanding, 5600);

  const refund = await service.create(userId, {
    kind: 'refund',
    description: 'Duplicate utility payment',
    total: 180,
    counterparty: 'Utility provider',
    entryDate: today(),
    paymentMethod: 'transfer',
    expectedReturnDate: offsetDate(5),
    refundStatus: 'requested',
    protocol: 'TEST-123',
    notes: '',
  });
  const paidRefund = await service.setRefundStatus(userId, refund.entry.id, 'received');
  assert.equal(paidRefund.entry.refundStatus, 'received');
  assert.equal(paidRefund.receipts.length, 1);
  await service.undoReceipt(userId, paidRefund.receipts[0].id);
  assert.equal((await service.get(userId, refund.entry.id)).entry.refundStatus, 'in_review');

  const overdue = await service.create(userId, {
    kind: 'loan',
    description: 'Overdue installment',
    total: 100,
    personId: String(secondPerson._id),
    entryDate: today(),
    paymentMethod: 'cash',
    installmentCount: 1,
    loanTerm: 'date',
    firstDueDate: offsetDate(-1),
    interestRate: 0,
    frequency: 'monthly',
    notes: '',
  });
  assert.equal(overdue.installments[0].status, 'overdue');
  const interestLoan = await service.create(userId, {
    kind: 'loan',
    description: 'Simple interest loan',
    total: 500,
    personId: String(person._id),
    entryDate: today(),
    paymentMethod: 'pix',
    installmentCount: 6,
    loanTerm: 'installments',
    firstDueDate: offsetDate(30),
    interestRate: 1,
    frequency: 'monthly',
    notes: '',
  });
  assert.equal(interestLoan.installments.reduce((sum, item) => sum + item.amountCents, 0), 53000);
  assert.equal(
    (await service.summary(userId, Number(today().slice(5, 7)), Number(today().slice(0, 4)))).overdueCount,
    1,
  );
});

test('editing a receivable keeps partial receipts and rejects totals below money already received', async () => {
  const { person, userId, service } = await fixture('cash-edit@example.invalid');
  const entry = await service.create(userId, {
    kind: 'loan',
    description: 'Installment loan',
    total: 100,
    personId: String(person._id),
    entryDate: today(),
    paymentMethod: 'pix',
    installmentCount: 2,
    loanTerm: 'installments',
    firstDueDate: offsetDate(2),
    interestRate: 0,
    frequency: 'monthly',
    notes: '',
  });
  const first = entry.installments[0];
  await service.receive(userId, first.id, { amount: 20, receivedOn: today(), paymentMethod: 'pix' });
  const updated = await service.update(userId, entry.entry.id, {
    kind: 'loan',
    description: 'Updated installment loan',
    total: 120,
    personId: String(person._id),
    entryDate: today(),
    paymentMethod: 'pix',
    installmentCount: 2,
    loanTerm: 'installments',
    firstDueDate: offsetDate(2),
    interestRate: 0,
    frequency: 'monthly',
    notes: '',
  });
  const retained = updated.installments.find((item) => item.id === first.id);
  assert.equal(retained.received, 20);
  assert.equal(retained.amount, 60);
  await assert.rejects(
    service.update(userId, entry.entry.id, {
      kind: 'loan',
      description: 'Invalid loan amount',
      total: 15,
      personId: String(person._id),
      entryDate: today(),
      paymentMethod: 'pix',
      installmentCount: 2,
      loanTerm: 'installments',
      firstDueDate: offsetDate(2),
      interestRate: 0,
      frequency: 'monthly',
      notes: '',
    }),
    /menor que o total já recebido/,
  );
});

test('private cash-ledger API persists entries and blocks cross-user access', async () => {
  const owner = await createTestAccount({ email: 'cash-api-owner@example.invalid' });
  const other = await createTestAccount({ email: 'cash-api-other@example.invalid' });
  const ownerApi = createApiClient(baseUrl, owner.cookie);
  const otherApi = createApiClient(baseUrl, other.cookie);

  const expense = await ownerApi('POST', '/cash-ledger/entries', {
    kind: 'expense',
    description: 'API coffee',
    total: 25,
    entryDate: today(),
    paymentMethod: 'pix',
  });
  assert.equal(expense.status, 201, expense.text);
  const saleResponse = await ownerApi('POST', '/cash-ledger/entries', sale(String(owner.person._id)));
  assert.equal(saleResponse.status, 201, saleResponse.text);
  assert.equal(saleResponse.json.data.installments.length, 7);

  const installmentId = saleResponse.json.data.installments[1].id;
  const receipt = await ownerApi('POST', `/cash-ledger/installments/${installmentId}/receipts`, {
    amount: 400,
    receivedOn: today(),
    paymentMethod: 'pix',
  });
  assert.equal(receipt.status, 201, receipt.text);
  const detail = await ownerApi('GET', `/cash-ledger/entries/${saleResponse.json.data.entry.id}`);
  assert.equal(detail.json.data.installments[1].status, 'partial');
  const summary = await ownerApi('GET', `/cash-ledger/summary?month=${Number(today().slice(5, 7))}&year=${Number(today().slice(0, 4))}`);
  assert.equal(summary.status, 200);
  assert.equal(summary.json.data.spent, 25);
  const dashboard = await ownerApi('GET', `/cash-ledger/dashboard?period=all&month=${Number(today().slice(5, 7))}&year=${Number(today().slice(0, 4))}`);
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.json.data.totals.spentCents, 2500);
  assert.equal(dashboard.json.data.byPaymentMethod.find((item) => item.label === 'Pix').amountCents, 2500);
  assert.equal((await otherApi('GET', `/cash-ledger/entries/${saleResponse.json.data.entry.id}`)).status, 404);
  const crossAccount = await otherApi('POST', '/cash-ledger/entries', sale(String(owner.person._id)));
  assert.equal(crossAccount.status, 400);
});
