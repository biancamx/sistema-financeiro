import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'development';
process.env.JWT_SECRET = 'test-secret-for-auth-routes';
process.env.AI_KEY_SECRET = 'a'.repeat(64);
process.env.JWT_EXPIRES_IN = '2h';
process.env.ADMIN_EMAIL = 'admin@example.com';
process.env.ALLOWED_DOMAINS = '';
process.env.ENABLE_LOCAL_LOGIN = 'false';
process.env.AUTH_RATE_LIMIT_MAX = '1000';

const [{ createApp }, { User }, { AuthSession }, { AuditEvent }, { SecurityAlert }, { ensureGoogleEmailVerified, ensureGoogleAccountLink }] = await Promise.all([
  import('../src/app.js'),
  import('../src/models/User.js'),
  import('../src/models/AuthSession.js'),
  import('../src/models/AuditEvent.js'),
  import('../src/models/SecurityAlert.js'),
  import('../src/modules/auth/auth.service.js'),
]);

let server;
let baseUrl;
const originalFindOne = User.findOne;
const originalCreate = User.create;
const originalFindById = User.findById;
const originalSessionCreate = AuthSession.create;
const originalSessionFind = AuthSession.find;
const originalSessionFindOne = AuthSession.findOne;
const originalSessionUpdateOne = AuthSession.updateOne;
const originalSessionUpdateMany = AuthSession.updateMany;
const originalAuditCreate = AuditEvent.create;
const originalAuditCountDocuments = AuditEvent.countDocuments;
const originalSecurityAlertFind = SecurityAlert.find;
const users = new Map();
const sessions = new Map();

function matchesSession(session, filter) {
  return session
    && String(session.userId) === String(filter.userId)
    && (!filter.tokenId || session.tokenId === filter.tokenId)
    && (!Object.hasOwn(filter, 'revokedAt') || session.revokedAt === null)
    && (!filter.expiresAt || session.expiresAt > filter.expiresAt.$gt);
}

function sessionQuery(result) {
  const query = {
    select: () => query,
    sort: () => query,
    lean: async () => result,
  };
  return query;
}

before(async () => {
  AuditEvent.create = async (event) => event;
  AuditEvent.countDocuments = async () => 1;
  User.findOne = async ({ email }) => users.get(email) || null;
  User.create = async (fields) => {
    const user = new User(fields);
    users.set(user.email, user);
    return user;
  };
  User.findById = (id) => ({
    select: async () => [...users.values()].find((user) => user._id.toString() === id.toString()) || null,
  });
  AuthSession.create = async (fields) => {
    const session = { ...fields, createdAt: new Date(), revokedAt: null };
    sessions.set(fields.tokenId, session);
    return session;
  };
  AuthSession.findOne = (filter) => sessionQuery(
    [...sessions.values()].find((session) => matchesSession(session, filter)) || null,
  );
  AuthSession.find = (filter) => sessionQuery(
    [...sessions.values()].filter((session) => matchesSession(session, filter)),
  );
  AuthSession.updateOne = async (filter, update) => {
    const session = sessions.get(filter.tokenId);
    if (!matchesSession(session, filter)) return { modifiedCount: 0 };
    Object.assign(session, update.$set);
    return { modifiedCount: 1 };
  };
  AuthSession.updateMany = async (filter, update) => {
    let modifiedCount = 0;
    for (const session of sessions.values()) {
      if (matchesSession(session, filter)) {
        Object.assign(session, update.$set);
        modifiedCount += 1;
      }
    }
    return { modifiedCount };
  };

  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  server.close();
  User.findOne = originalFindOne;
  User.create = originalCreate;
  User.findById = originalFindById;
  AuthSession.create = originalSessionCreate;
  AuthSession.find = originalSessionFind;
  AuthSession.findOne = originalSessionFindOne;
  AuthSession.updateOne = originalSessionUpdateOne;
  AuthSession.updateMany = originalSessionUpdateMany;
  AuditEvent.create = originalAuditCreate;
  AuditEvent.countDocuments = originalAuditCountDocuments;
  SecurityAlert.find = originalSecurityAlertFind;
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
  const sessionCookie = registration.headers.get('set-cookie') || '';
  assert.ok(sessionCookie.includes('caderno_token='));
  assert.match(sessionCookie, /Path=\//);
  const token = sessionCookie.match(/caderno_token=([^;]+)/)?.[1];
  const registrationCookie = `caderno_token=${token}`;
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
  const cookie = login.headers.get('set-cookie').split(';')[0];

  const currentUser = await fetch(`${baseUrl}/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(currentUser.status, 200);
  assert.equal((await currentUser.json()).data.user.email, 'login-test@example.com');

  const sessionList = await fetch(`${baseUrl}/auth/sessions`, { headers: { Cookie: cookie } });
  const activeSessions = (await sessionList.json()).data;
  assert.equal(activeSessions.length, 2);
  const previousSession = activeSessions.find((session) => !session.current);
  assert.ok(previousSession);

  const revoked = await fetch(`${baseUrl}/auth/sessions/${previousSession.id}`, {
    method: 'DELETE',
    headers: { Cookie: cookie, Origin: 'http://localhost:5173' },
  });
  assert.equal(revoked.status, 204);
  const oldSession = await fetch(`${baseUrl}/auth/me`, { headers: { Cookie: registrationCookie } });
  assert.equal(oldSession.status, 401);
  const stillCurrent = await fetch(`${baseUrl}/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(stillCurrent.status, 200);

  const otherRegistration = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Outro usuário',
      email: 'other-session@example.com',
      password: 'senha-segura-123',
    }),
  });
  const otherCookie = otherRegistration.headers.get('set-cookie').split(';')[0];
  const otherSessionList = await fetch(`${baseUrl}/auth/sessions`, { headers: { Cookie: otherCookie } });
  const otherSessionId = (await otherSessionList.json()).data[0].id;
  const crossUserRevoke = await fetch(`${baseUrl}/auth/sessions/${otherSessionId}`, {
    method: 'DELETE',
    headers: { Cookie: cookie, Origin: 'http://localhost:5173' },
  });
  assert.equal(crossUserRevoke.status, 404);
  const otherStillValid = await fetch(`${baseUrl}/auth/me`, { headers: { Cookie: otherCookie } });
  assert.equal(otherStillValid.status, 200);
});

test('email registration cannot claim the configured administrator identity', async () => {
  const response = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Admin não verificado',
      email: 'admin@example.com',
      password: 'senha-segura-123',
    }),
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'ADMIN_EMAIL_GOOGLE_REQUIRED');
  assert.equal(users.has('admin@example.com'), false);
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
  assert.throws(() => ensureGoogleAccountLink('existing-google-id', 'different-google-id'), { status: 401 });
  assert.doesNotThrow(() => ensureGoogleAccountLink(null, 'new-google-id'));
  assert.doesNotThrow(() => ensureGoogleAccountLink('same-google-id', 'same-google-id'));
});

test('Google redirect callback accepts client ID metadata and still enforces CSRF', async () => {
  const response = await fetch(`${baseUrl}/auth/google/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      credential: 'unverified-test-credential',
      clientId: 'test-client-id',
      client_id: 'test-client-id',
    }),
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'Token CSRF do Google inválido');
});

test('logout clears current and legacy session cookies', async () => {
  const logout = await fetch(`${baseUrl}/auth/logout`, { method: 'POST' });
  assert.equal(logout.status, 200);
  const clearedCookies = logout.headers.get('set-cookie') || '';
  assert.match(clearedCookies, /caderno_token=;/);
  assert.match(clearedCookies, /fin_token=;/);
  assert.match(clearedCookies, /Path=\/api\/auth/);
});

test('logout and logout-all revoke server-side sessions', async () => {
  const registration = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Logout test',
      email: 'logout-test@example.com',
      password: 'senha-segura-123',
    }),
  });
  const firstCookie = registration.headers.get('set-cookie').split(';')[0];

  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'logout-test@example.com', password: 'senha-segura-123' }),
  });
  const secondCookie = login.headers.get('set-cookie').split(';')[0];

  const logoutAll = await fetch(`${baseUrl}/auth/logout-all`, {
    method: 'POST',
    headers: { Cookie: secondCookie, Origin: 'http://localhost:5173' },
  });
  assert.equal(logoutAll.status, 200);
  for (const cookie of [firstCookie, secondCookie]) {
    const response = await fetch(`${baseUrl}/auth/me`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 401);
  }
});

test('email login rejects invalid credentials and registration validates input', async () => {
  const invalidCredentials = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'login-test@example.com', password: 'senha-incorreta' }),
  });

  assert.equal(invalidCredentials.status, 401);

  const invalidRegistration = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Teste', email: 'invalido', password: '123' }),
  });
  assert.equal(invalidRegistration.status, 400);
});

test('security alert listing is restricted to the authenticated user', async () => {
  const registration = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Alerta isolado',
      email: 'alerts-owner@example.com',
      password: 'senha-segura-123',
    }),
  });
  const token = (registration.headers.get('set-cookie') || '').match(/caderno_token=([^;]+)/)?.[1];
  assert.ok(token);
  const ownerId = users.get('alerts-owner@example.com')._id.toString();
  const alerts = [
    { _id: 'owner-alert', userId: ownerId, alertType: 'repeated_login_failures' },
    { _id: 'other-alert', userId: '000000000000000000000001', alertType: 'cross_user_access' },
  ];
  SecurityAlert.find = (filter) => {
    assert.equal(String(filter.userId), ownerId);
    const query = {
      select: () => query,
      sort: () => query,
      limit: () => query,
      lean: async () => alerts.filter((alert) => alert.userId === String(filter.userId)),
    };
    return query;
  };

  const response = await fetch(`${baseUrl}/auth/security-alerts`, {
    headers: { Cookie: `caderno_token=${token}` },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.data.map((alert) => alert._id), ['owner-alert']);
});

test('JWT authentication rejects legacy claims and non-HS256 signatures', async () => {
  const legacyToken = jwt.sign({ sub: '507f1f77bcf86cd799439011' }, process.env.JWT_SECRET);
  const legacyResponse = await fetch(`${baseUrl}/auth/me`, {
    headers: { Authorization: `Bearer ${legacyToken}` },
  });
  assert.equal(legacyResponse.status, 401);

  const wrongAlgorithm = jwt.sign(
    { sub: '507f1f77bcf86cd799439011' },
    process.env.JWT_SECRET,
    {
      algorithm: 'HS512',
      issuer: 'caderno-contas',
      audience: 'caderno-contas-web',
      jwtid: 'a'.repeat(43),
      expiresIn: '1h',
    },
  );
  const wrongAlgorithmResponse = await fetch(`${baseUrl}/auth/me`, {
    headers: { Authorization: `Bearer ${wrongAlgorithm}` },
  });
  assert.equal(wrongAlgorithmResponse.status, 401);
});

test('development API accepts Vite fallback ports but rejects remote origins', async () => {
  const localOrigin = await fetch(`${baseUrl}/people`, {
    method: 'POST',
    headers: { Origin: 'http://localhost:5174', 'Content-Type': 'application/json' },
    body: '{}',
  });

  test('cookie-authenticated writes require a verifiable same-origin request', async () => {
    const denied = await fetch(`${baseUrl}/people`, {
      method: 'POST',
      headers: { Cookie: 'caderno_token=not-a-valid-token', 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(denied.status, 403);

    const allowed = await fetch(`${baseUrl}/people`, {
      method: 'POST',
      headers: {
        Cookie: 'caderno_token=not-a-valid-token',
        Origin: 'http://localhost:5173',
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    assert.equal(allowed.status, 401);
  });
  assert.equal(localOrigin.status, 401);

  const remoteOrigin = await fetch(`${baseUrl}/people`, {
    method: 'POST',
    headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(remoteOrigin.status, 403);
});
