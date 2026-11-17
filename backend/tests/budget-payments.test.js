import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearMongoMemory, createApiClient, createTestAccount, startMongoMemory } from './helpers/mongo.js';

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
