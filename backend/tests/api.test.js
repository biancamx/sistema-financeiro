import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearMongoMemory, createApiClient, createTestAccount, startMongoMemory } from './helpers/mongo.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-api';
process.env.ENABLE_LOCAL_LOGIN = 'true';
process.env.RATE_LIMIT_MAX = '100000';
process.env.AUTH_RATE_LIMIT_MAX = '100000';

const [{ createApp }, { buildSchedule, splitAmount, splitWeighted }, { calcRescission }] = await Promise.all([
  import('../src/app.js'),
  import('../src/modules/purchases/purchases.service.js'),
  import('../src/modules/tools/rescission.js'),
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

test('health pública responde e as rotas privadas exigem sessão', async () => {
  const anonymous = createApiClient(baseUrl);
  const health = await anonymous('GET', '/system/health');
  assert.equal(health.status, 200);
  assert.equal(health.json.status, 'ok');
  assert.ok(health.headers.get('x-request-id'));
  assert.equal((await anonymous('GET', '/people')).status, 401);
});

test('compra parcelada cria, atualiza e remove parcelas no MongoDB', async () => {
  const account = await createTestAccount({ email: 'installments@example.invalid' });
  const api = createApiClient(baseUrl, account.cookie);
  const body = {
    description: 'Purchase with installments',
    personId: String(account.person._id),
    cardId: String(account.card._id),
    purchaseDate: '2099-01-02',
    total: 100,
    count: 3,
    startMonth: 1,
    startYear: 2099,
  };

  const created = await api('POST', '/purchases', body);
  assert.equal(created.status, 201, created.text);
  assert.deepEqual(
    created.json.data.installments.map(({ number, year, month, amount }) => [number, year, month, amount]),
    [[1, 2099, 1, 33.34], [2, 2099, 2, 33.33], [3, 2099, 3, 33.33]],
  );
  assert.equal(created.json.data.installments.reduce((sum, item) => sum + item.amount, 0), 100);

  const updated = await api('PUT', `/purchases/${created.json.data.id}`, { ...body, total: 120, count: 4 });
  assert.equal(updated.status, 200, updated.text);
  assert.equal(updated.json.data.installments.length, 4);
  assert.equal(updated.json.data.installments.reduce((sum, item) => sum + item.amount, 0), 120);

  const fetched = await api('GET', `/purchases/${created.json.data.id}`);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.json.data.installments.length, 4);
  assert.equal((await api('DELETE', `/purchases/${created.json.data.id}`)).status, 204);
  assert.equal((await api('GET', `/purchases/${created.json.data.id}`)).status, 404);
});

test('compras e referências permanecem isoladas entre usuários', async () => {
  const owner = await createTestAccount({ email: 'owner@example.invalid' });
  const other = await createTestAccount({ email: 'other@example.invalid' });
  const ownerApi = createApiClient(baseUrl, owner.cookie);
  const otherApi = createApiClient(baseUrl, other.cookie);
  const purchase = await ownerApi('POST', '/purchases', {
    description: 'Private purchase',
    personId: String(owner.person._id),
    cardId: String(owner.card._id),
    total: 60,
    count: 2,
    startMonth: 1,
    startYear: 2099,
  });
  assert.equal(purchase.status, 201, purchase.text);

  assert.equal((await otherApi('GET', `/purchases/${purchase.json.data.id}`)).status, 404);
  assert.equal((await otherApi('DELETE', `/purchases/${purchase.json.data.id}`)).status, 404);
  assert.deepEqual((await otherApi('GET', '/purchases')).json.data, []);
  const crossAccountPurchase = await otherApi('POST', '/purchases', {
    description: 'Invalid cross-account reference',
    personId: String(owner.person._id),
    cardId: String(owner.card._id),
    total: 10,
    count: 1,
    startMonth: 1,
    startYear: 2099,
  });
  assert.equal(crossAccountPurchase.status, 400);
});

test('divisão de valores fecha em centavos e agenda períodos consecutivos', () => {
  assert.deepEqual(buildSchedule({ total: 100, count: 3, startYear: 2099, startMonth: 11 }).map(({ year, month }) => [year, month]), [
    [2099, 11], [2099, 12], [2100, 1],
  ]);
  assert.deepEqual(splitAmount(100, 3), [33.34, 33.33, 33.33]);
  assert.deepEqual(splitWeighted(100, [50, 30, 20]), [50, 30, 20]);
});

test('cálculo de rescisão mantém os valores da fórmula', () => {
  const result = calcRescission({
    salary: 3000,
    admission: '2024-01-01',
    dismissal: '2026-03-10',
    reason: 'Sem justa causa',
    notice: 'Trabalhado',
    fgtsBalance: 2000,
  });
  const values = Object.fromEntries(result.items.map((item) => [item.key, item.value]));
  assert.equal(values.salaryBalance, 1000);
  assert.equal(values.thirteenth, 500);
  assert.equal(values.vacation, 666.67);
  assert.equal(typeof result.totalToReceive, 'number');
});
