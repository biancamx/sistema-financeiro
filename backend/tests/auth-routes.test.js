import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'development';
process.env.JWT_SECRET = 'test-secret-for-auth-routes';
process.env.AI_KEY_SECRET = 'a'.repeat(64);
process.env.JWT_EXPIRES_IN = '2h';
process.env.ALLOWED_DOMAINS = '';
process.env.ENABLE_LOCAL_LOGIN = 'false';
process.env.AUTH_RATE_LIMIT_MAX = '1000';

const [{ createApp }, { User }, { AccessAuditLog }, { ensureGoogleEmailVerified }] = await Promise.all([
  import('../src/app.js'),
  import('../src/models/User.js'),
  import('../src/models/AccessAuditLog.js'),
  import('../src/modules/auth/auth.service.js'),
]);

let server;
let baseUrl;
const originalFindOne = User.findOne;
const originalCreate = User.create;
const originalFindById = User.findById;
const originalAuditCreate = AccessAuditLog.create;
const originalAuditFind = AccessAuditLog.find;
const originalAuditCount = AccessAuditLog.countDocuments;
const users = new Map();
const auditEvents = [];
let registeredCookie;

function matchesAuditFilter(record, filter) {
  const matchesIdentity = !filter.$or || filter.$or.some((condition) => (
    condition.userId
      ? String(record.userId) === String(condition.userId)
      : record.email === condition.email
  ));
  return matchesIdentity
    && (!filter.event || record.event === filter.event)
    && (!filter.outcome || record.outcome === filter.outcome);
}

async function waitForAuditEvents(count) {
  for (let attempt = 0; auditEvents.length < count && attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(auditEvents.length >= count, `Expected at least ${count} access audit events`);
}

before(async () => {
  User.findOne = async ({ email }) => users.get(email) || null;
  User.create = async (fields) => {
    const user = new User(fields);
    users.set(user.email, user);
    return user;
  };
  User.findById = (id) => ({
    select: async () => [...users.values()].find((user) => user._id.toString() === id.toString()) || null,
  });
  AccessAuditLog.create = async (event) => {
    const record = { ...event, _id: String(auditEvents.length + 1), createdAt: new Date() };
    auditEvents.push(record);
    return record;
  };
  AccessAuditLog.find = (filter) => {
    let offset = 0;
    let limit = auditEvents.length;
    const query = {
      select: () => query,
      sort: () => query,
      skip: (value) => { offset = value; return query; },
      limit: (value) => { limit = value; return query; },
      lean: async () => auditEvents.filter((record) => matchesAuditFilter(record, filter)).slice(offset, offset + limit),
    };
    return query;
  };
  AccessAuditLog.countDocuments = async (filter) => auditEvents.filter((record) => matchesAuditFilter(record, filter)).length;

  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  server.close();
  User.findOne = originalFindOne;
  User.create = originalCreate;
  User.findById = originalFindById;
  AccessAuditLog.create = originalAuditCreate;
  AccessAuditLog.find = originalAuditFind;
  AccessAuditLog.countDocuments = originalAuditCount;
});

test('email registration creates a session that can log in and access authenticated routes', async () => {
  const registration = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Teste de Login',
      email: 'LOGIN-TEST@example.com',
      password: 'senha-segura-123',
    }),
  });
  assert.equal(registration.status, 201);
  const registered = await registration.json();
  assert.equal(registered.data.user.email, 'login-test@example.com');
  await waitForAuditEvents(1);
  assert.equal(auditEvents[0].event, 'registration');
  assert.equal(auditEvents[0].outcome, 'success');
  assert.equal(auditEvents[0].email, 'login-test@example.com');
  assert.equal('password' in auditEvents[0], false);
  const sessionCookie = registration.headers.get('set-cookie') || '';
  assert.ok(sessionCookie.includes('caderno_token='));
  assert.match(sessionCookie, /Path=\//);
  const token = sessionCookie.match(/caderno_token=([^;]+)/)?.[1];
  registeredCookie = `caderno_token=${token}`;
  users.get('login-test@example.com').status = 'active';
  const claims = jwt.decode(token);
  assert.equal(claims.exp - claims.iat, 2 * 60 * 60);
  const cookieMaxAge = Number(sessionCookie.match(/Max-Age=(\d+)/i)?.[1]);
  assert.ok(cookieMaxAge >= 7190 && cookieMaxAge <= 7200);
  assert.equal('passwordHash' in registered.data.user, false);

  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'login-test@example.com', password: 'senha-segura-123' }),
  });
  assert.equal(login.status, 200);
  await waitForAuditEvents(2);
  assert.equal(auditEvents[1].event, 'login');
  assert.equal(auditEvents[1].outcome, 'success');
  const cookie = login.headers.get('set-cookie').split(';')[0];

  const currentUser = await fetch(`${baseUrl}/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(currentUser.status, 200);
  assert.equal((await currentUser.json()).data.user.email, 'login-test@example.com');

  const logout = await fetch(`${baseUrl}/auth/logout`, {
    method: 'POST',
    headers: { Cookie: registeredCookie },
  });
  assert.equal(logout.status, 200);
  await waitForAuditEvents(3);
  assert.equal(auditEvents[2].event, 'logout');
  assert.equal(auditEvents[2].outcome, 'success');
});

test('access audit only returns records related to the signed-in account', async () => {
  auditEvents.push({
    _id: 'foreign-record',
    event: 'login',
    outcome: 'success',
    userId: 'another-user',
    email: 'another@example.com',
    provider: 'password',
    ipAddress: '127.0.0.1',
    userAgent: 'test',
    createdAt: new Date(),
  });

  const response = await fetch(`${baseUrl}/audit/access`, {
    headers: { Cookie: registeredCookie },
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.data.scope, 'account');
  assert.ok(result.data.events.length >= 2);
  assert.equal(result.data.events.some((event) => event.email === 'another@example.com'), false);
});

test('administrators can review access records across accounts', async () => {
  const admin = new User({
    name: 'Administrador',
    email: 'admin@example.com',
    role: 'admin',
    status: 'active',
  });
  users.set(admin.email, admin);
  const token = jwt.sign({ sub: admin._id.toString() }, 'test-secret-for-auth-routes');

  const response = await fetch(`${baseUrl}/audit/access`, {
    headers: { Cookie: `caderno_token=${token}` },
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.data.scope, 'all');
  assert.equal(result.data.events.some((event) => event.email === 'another@example.com'), true);
});

test('local login config reports the same disabled policy enforced by its route', async () => {
  const config = await fetch(`${baseUrl}/auth/config`);
  assert.equal((await config.json()).local.enabled, false);

  const localLogin = await fetch(`${baseUrl}/auth/local`, { method: 'POST' });
  assert.equal(localLogin.status, 404);
});

test('Google login requires an explicitly verified email claim', () => {
  assert.throws(() => ensureGoogleEmailVerified({ email_verified: false }), { status: 401 });
  assert.throws(() => ensureGoogleEmailVerified({ email_verified: 'true' }), { status: 401 });
  assert.doesNotThrow(() => ensureGoogleEmailVerified({ email_verified: true }));
});

test('logout clears current and legacy session cookies', async () => {
  const logout = await fetch(`${baseUrl}/auth/logout`, { method: 'POST' });
  assert.equal(logout.status, 200);
  const clearedCookies = logout.headers.get('set-cookie') || '';
  assert.match(clearedCookies, /caderno_token=;/);
  assert.match(clearedCookies, /fin_token=;/);
  assert.match(clearedCookies, /Path=\/api\/auth/);
});

test('email login rejects invalid credentials and registration validates input', async () => {
  const invalidCredentials = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'login-test@example.com', password: 'senha-incorreta' }),
  });
  assert.equal(invalidCredentials.status, 401);
  await waitForAuditEvents(5);
  const failedLogin = auditEvents.filter((event) => event.event === 'login').slice(-1)[0];
  assert.equal(failedLogin.outcome, 'failure');
  assert.equal(failedLogin.email, 'login-test@example.com');
  assert.equal('password' in failedLogin, false);

  const invalidRegistration = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Teste', email: 'invalido', password: '123' }),
  });
  assert.equal(invalidRegistration.status, 400);
  await waitForAuditEvents(6);
  const failedRegistration = auditEvents.filter((event) => event.event === 'registration').slice(-1)[0];
  assert.equal(failedRegistration.outcome, 'failure');
  assert.equal('password' in failedRegistration, false);
});

test('development API accepts Vite fallback ports but rejects remote origins', async () => {
  const localOrigin = await fetch(`${baseUrl}/people`, {
    method: 'POST',
    headers: { Origin: 'http://localhost:5174', 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(localOrigin.status, 401);

  const remoteOrigin = await fetch(`${baseUrl}/people`, {
    method: 'POST',
    headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(remoteOrigin.status, 403);
});
