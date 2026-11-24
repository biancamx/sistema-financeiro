import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-domain-access';
process.env.ADMIN_EMAIL = 'admin@company.test';
process.env.ALLOWED_DOMAINS = ' Gmail.com, invited@company.test ';
process.env.AUTH_RATE_LIMIT_MAX = '1000';

const [{ createApp }, { User }, { AuthSession }, { AuditEvent }] = await Promise.all([
  import('../src/app.js'),
  import('../src/models/User.js'),
  import('../src/models/AuthSession.js'),
  import('../src/models/AuditEvent.js'),
]);

let server;
let baseUrl;
const originalFindOne = User.findOne;
const originalCreate = User.create;
const originalSessionCreate = AuthSession.create;
const originalAuditCreate = AuditEvent.create;
const users = new Map();

before(async () => {
  AuditEvent.create = async (event) => event;
  User.findOne = async ({ email }) => users.get(email) || null;
  User.create = async (fields) => {
    const user = new User(fields);
    users.set(user.email, user);
    return user;
  };
  AuthSession.create = async (fields) => fields;
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => {
  server.close();
  User.findOne = originalFindOne;
  User.create = originalCreate;
  AuthSession.create = originalSessionCreate;
  AuditEvent.create = originalAuditCreate;
});

async function register(email) {
  const response = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Teste', email, password: 'senha-segura-123' }),
  });
  return { status: response.status, body: await response.json() };
}

test('allowlist accepts domains and exact addresses but reserves the admin identity for Google', async () => {
  assert.equal((await register('pessoa@gmail.com')).status, 201);
  assert.equal((await register('invited@company.test')).status, 201);
  const admin = await register('ADMIN@company.test');
  assert.equal(admin.status, 403);
  assert.equal(admin.body.error.code, 'ADMIN_EMAIL_GOOGLE_REQUIRED');
});

test('allowlist rejects registration from an unauthorized email', async () => {
  const response = await register('pessoa@other.test');
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'EMAIL_NOT_ALLOWED');
});
