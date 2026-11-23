import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateVAPIDKeys } from 'web-push';
import { clearMongoMemory, createApiClient, createTestAccount, startMongoMemory } from './helpers/mongo.js';

const vapidKeys = generateVAPIDKeys();
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-push';
process.env.JOBS_TOKEN = 'push-jobs-test-token';
process.env.VAPID_PUBLIC_KEY = vapidKeys.publicKey;
process.env.VAPID_PRIVATE_KEY = vapidKeys.privateKey;
process.env.VAPID_SUBJECT = 'mailto:push-tests@example.invalid';

const [{ createApp }, { PushSubscription }, { PushDelivery }, { Birthday }, { Purchase }, { Installment }, { sendDueAlerts }, { sendPushToUser, webPushClient }] = await Promise.all([
  import('../src/app.js'),
  import('../src/models/PushSubscription.js'),
  import('../src/models/PushDelivery.js'),
  import('../src/models/Birthday.js'),
  import('../src/models/Purchase.js'),
  import('../src/models/Installment.js'),
  import('../src/modules/push/pushJobs.service.js'),
  import('../src/modules/push/push.service.js'),
]);

let stopMongo;
let server;
let apiBaseUrl;
let appBaseUrl;

before(async () => {
  stopMongo = await startMongoMemory();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  appBaseUrl = `http://127.0.0.1:${server.address().port}`;
  apiBaseUrl = `${appBaseUrl}/api`;
});

beforeEach(clearMongoMemory);

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (stopMongo) await stopMongo();
});

test('assinaturas push exigem sessão e permanecem isoladas por usuário', async () => {
  const anonymous = createApiClient(apiBaseUrl);
  assert.equal((await anonymous('GET', '/push/vapid-public-key')).status, 401);

  const owner = await createTestAccount({ email: 'push-owner@example.invalid' });
  const other = await createTestAccount({ email: 'push-other@example.invalid' });
  const ownerApi = createApiClient(apiBaseUrl, owner.cookie);
  const otherApi = createApiClient(apiBaseUrl, other.cookie);
  const endpoint = 'https://push.example.invalid/subscription/owner';
  const subscription = {
    endpoint,
    keys: { p256dh: 'public-key', auth: 'auth-key' },
    expirationTime: null,
  };

  const keyResponse = await ownerApi('GET', '/push/vapid-public-key');
  assert.equal(keyResponse.status, 200);
  assert.equal(keyResponse.json.data.publicKey, vapidKeys.publicKey);

  const saved = await ownerApi('POST', '/push/subscriptions', {
    subscription,
    userAgent: 'iPhone test',
  });
  assert.equal(saved.status, 201, saved.text);
  const stored = await PushSubscription.findOne({ endpoint }).select('+keys.p256dh +keys.auth');
  assert.equal(String(stored.userId), String(owner.user._id));
  assert.equal(stored.userAgent, 'iPhone test');
  assert.equal(stored.keys.p256dh, subscription.keys.p256dh);
  assert.equal(stored.keys.auth, subscription.keys.auth);

  assert.equal((await otherApi('DELETE', '/push/subscriptions', { endpoint })).status, 204);
  assert.equal(await PushSubscription.countDocuments({ endpoint }), 1);
  assert.equal((await ownerApi('DELETE', '/push/subscriptions', { endpoint })).status, 204);
  assert.equal(await PushSubscription.countDocuments({ endpoint }), 0);
});

test('rotas de jobs exigem token e validam o usuário do teste', async () => {
  const unauthorized = await fetch(`${appBaseUrl}/jobs/notificar`, { method: 'POST' });
  assert.equal(unauthorized.status, 401);

  const invalid = await fetch(`${appBaseUrl}/jobs/notificar`, {
    method: 'POST',
    headers: { 'x-jobs-token': 'wrong-token' },
  });
  assert.equal(invalid.status, 401);

  const owner = await createTestAccount({ email: 'push-job-owner@example.invalid' });
  const tested = await fetch(`${appBaseUrl}/jobs/teste`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-jobs-token': process.env.JOBS_TOKEN },
    body: JSON.stringify({ userId: String(owner.user._id) }),
  });
  assert.equal(tested.status, 200);
  assert.equal((await tested.json()).attempted, 0);

  const scheduled = await fetch(`${appBaseUrl}/jobs/notificar`, {
    method: 'POST',
    headers: { 'x-jobs-token': process.env.JOBS_TOKEN },
  });
  assert.equal(scheduled.status, 200);
  assert.equal((await scheduled.json()).users, 0);
});

test('job envia apenas alertas devidos e deduplica chamadas repetidas', async () => {
  const owner = await createTestAccount({ email: 'push-dedup@example.invalid' });
  await PushSubscription.create({
    userId: owner.user._id,
    endpoint: 'https://push.example.invalid/subscription/dedup',
    keys: { p256dh: 'public-key', auth: 'auth-key' },
    userAgent: 'test',
  });
  const purchase = await Purchase.create({
    userId: owner.user._id,
    personId: owner.person._id,
    cardId: owner.card._id,
    description: 'Compra para alerta push',
    purchaseDate: '2099-01-02',
    totalAmount: 25,
    totalInstallments: 1,
  });
  await Installment.create({
    userId: owner.user._id,
    purchaseId: purchase._id,
    number: 1,
    year: 2099,
    month: 1,
    amount: 25,
  });

  const originalSendNotification = webPushClient.sendNotification;
  let sendCount = 0;
  webPushClient.sendNotification = async () => { sendCount += 1; };
  try {
    const dueDate = new Date(2099, 0, 10, 12);
    const first = await sendDueAlerts(dueDate);
    assert.equal(first.alerts, 1);
    assert.equal(first.sent, 1);
    assert.equal(sendCount, 1);

    const repeated = await sendDueAlerts(dueDate);
    assert.equal(repeated.alerts, 1);
    assert.equal(repeated.skipped, 1);
    assert.equal(sendCount, 1);
    assert.equal(await PushDelivery.countDocuments({ state: 'sent' }), 1);
  } finally {
    webPushClient.sendNotification = originalSendNotification;
  }
});

test('assinaturas expiradas com resposta 404 ou 410 são removidas', async () => {
  const owner = await createTestAccount({ email: 'push-expired@example.invalid' });
  await PushSubscription.create({
    userId: owner.user._id,
    endpoint: 'https://push.example.invalid/subscription/not-found',
    keys: { p256dh: 'public-key', auth: 'auth-key' },
  });
  await PushSubscription.create({
    userId: owner.user._id,
    endpoint: 'https://push.example.invalid/subscription/gone',
    keys: { p256dh: 'public-key', auth: 'auth-key' },
  });
  const originalSendNotification = webPushClient.sendNotification;
  webPushClient.sendNotification = async (subscription) => {
    const error = new Error('Subscription expired');
    error.statusCode = subscription.endpoint.endsWith('/not-found') ? 404 : 410;
    throw error;
  };

  try {
    const result = await sendPushToUser(owner.user._id, { title: 'Teste' });
    assert.equal(result.expired, 2);
    assert.equal(await PushSubscription.countDocuments({ userId: owner.user._id }), 0);
  } finally {
    webPushClient.sendNotification = originalSendNotification;
  }
});

test('job envia notificação push no dia do aniversário e deduplica o envio', async () => {
  const owner = await createTestAccount({ email: 'push-birthday@example.invalid' });
  await PushSubscription.create({
    userId: owner.user._id,
    endpoint: 'https://push.example.invalid/subscription/birthday',
    keys: { p256dh: 'public-key', auth: 'auth-key' },
    userAgent: 'test',
  });
  await Birthday.create({
    userId: owner.user._id,
    personId: owner.person._id,
    name: owner.person.name,
    day: 22,
    month: 11,
  });

  const originalSendNotification = webPushClient.sendNotification;
  let sentPayload = null;
  webPushClient.sendNotification = async (_subscription, payload) => {
    sentPayload = JSON.parse(payload);
  };
  try {
    const dueDate = new Date(2099, 10, 22, 12);
    const first = await sendDueAlerts(dueDate);
    assert.equal(first.alerts, 1);
    assert.equal(first.sent, 1);
    assert.equal(sentPayload.title, `Aniversário de ${owner.person.name}`);
    assert.equal(sentPayload.url, '/pessoas?tab=aniversarios');

    const repeated = await sendDueAlerts(dueDate);
    assert.equal(repeated.skipped, 1);
    assert.equal(await PushDelivery.countDocuments({ state: 'sent' }), 1);
  } finally {
    webPushClient.sendNotification = originalSendNotification;
  }
});
