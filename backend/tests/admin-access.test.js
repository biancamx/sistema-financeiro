import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-access-control';
process.env.ADMIN_EMAIL = 'admin@example.com';
process.env.ALLOWED_DOMAINS = '';
process.env.AUTH_RATE_LIMIT_MAX = '1000';

const [{ createApp }, { User }, { AuthSession }, { AuditEvent }, { SecurityAlert }, { PushSubscription }] = await Promise.all([
  import('../src/app.js'),
  import('../src/models/User.js'),
  import('../src/models/AuthSession.js'),
  import('../src/models/AuditEvent.js'),
  import('../src/models/SecurityAlert.js'),
  import('../src/models/PushSubscription.js'),
]);

let server;
let baseUrl;
const originalFindOne = User.findOne;
const originalCreate = User.create;
const originalFindById = User.findById;
const originalFind = User.find;
const originalSessionCreate = AuthSession.create;
const originalSessionFindOne = AuthSession.findOne;
const originalSessionUpdateMany = AuthSession.updateMany;
const originalAuditCreate = AuditEvent.create;
const originalSecurityAlertCreate = SecurityAlert.create;
const originalPushSubscriptionFind = PushSubscription.find;
const users = new Map();
const sessions = new Map();
let pendingCookie;

function fakeQuery(user) {
  return { select: async () => user || null };
}

before(async () => {
  AuditEvent.create = async (event) => event;
  SecurityAlert.create = async (alerts) => alerts;
  PushSubscription.find = () => {
    const query = { select: () => query, lean: async () => [] };
    return query;
  };
  User.findOne = async ({ email }) => users.get(email) || null;
  User.create = async (fields) => {
    const user = new User(fields);
    user.save = async () => {
      users.set(user.email, user);
      return user;
    };
    users.set(user.email, user);
    return user;
  };
  User.findById = (id) => fakeQuery([...users.values()].find((user) => user._id.toString() === id.toString()));
  User.find = () => {
    const query = {
      select: () => query,
      sort: () => query,
      lean: async () => [...users.values()].map((user) => user.toObject()),
    };
    return query;
  };
  AuthSession.create = async (fields) => {
    const session = { ...fields, createdAt: new Date(), revokedAt: null };
    sessions.set(fields.tokenId, session);
    return session;
  };
  AuthSession.findOne = (filter) => {
    const query = {
      select: () => query,
      lean: async () => {
        const session = sessions.get(filter.tokenId);
        return session
          && String(session.userId) === String(filter.userId)
          && session.revokedAt === null
          && session.expiresAt > filter.expiresAt.$gt
          ? session
          : null;
      },
    };
    return query;
  };
  AuthSession.updateMany = async (filter, update) => {
    for (const session of sessions.values()) {
      if (String(session.userId) === String(filter.userId) && session.revokedAt === null) {
        Object.assign(session, update.$set);
      }
    }
    return { modifiedCount: 1 };
  };

  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => {
  server.close();
  User.findOne = originalFindOne;
  User.create = originalCreate;
  User.findById = originalFindById;
  User.find = originalFind;
  AuthSession.create = originalSessionCreate;
  AuthSession.findOne = originalSessionFindOne;
  AuthSession.updateMany = originalSessionUpdateMany;
  AuditEvent.create = originalAuditCreate;
  SecurityAlert.create = originalSecurityAlertCreate;
  PushSubscription.find = originalPushSubscriptionFind;
});

async function register(name, email) {
  const response = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password: 'senha-segura-123' }),
  });
  return {
    response,
    body: await response.json(),
    cookie: response.headers.get('set-cookie')?.split(';')[0],
  };
}

test('normal accounts await approval and the configured admin uses a verified identity', async () => {
  const regular = await register('Usuário Pendente', 'pending@example.com');
  assert.equal(regular.response.status, 201);
  assert.equal(regular.body.data.user.status, 'pending');
  assert.equal(regular.body.data.user.role, 'user');
  pendingCookie = regular.cookie;

  const pendingRequest = await fetch(`${baseUrl}/people`, { headers: { Cookie: regular.cookie } });
  assert.equal(pendingRequest.status, 403);
  assert.equal((await pendingRequest.json()).error.code, 'ACCOUNT_PENDING');

  const adminUser = new User({
    name: 'Administradora',
    email: 'admin@example.com',
    passwordHash: await bcrypt.hash('test-only-password', 4),
    googleId: 'verified-google-account',
    status: 'active',
    role: 'admin',
  });
  users.set(adminUser.email, adminUser);
});

test('admin can list and approve users; blocked users remain denied', async () => {
  const pending = users.get('pending@example.com');
  const adminCookie = [...users.values()].find((user) => user.role === 'admin');
  const adminLogin = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminCookie.email, password: 'test-only-password' }),
  });

  test('administrative changes require a session issued within five minutes', async () => {
    await register('Alvo da confirmação', 'reauth-target@example.com');
    const target = users.get('reauth-target@example.com');
    const admin = users.get('admin@example.com');
    const issuedAt = Math.floor(Date.now() / 1000) - 301;
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const tokenId = 'R'.repeat(43);
    const token = jwt.sign({
      sub: admin._id.toString(),
      email: admin.email,
      name: admin.name,
      status: admin.status,
      role: admin.role,
      iat: issuedAt,
      exp: expiresAt,
      jti: tokenId,
    }, process.env.JWT_SECRET, {
      algorithm: 'HS256',
      issuer: 'caderno-contas',
      audience: 'caderno-contas-web',
    });
    await AuthSession.create({
      userId: admin._id,
      tokenId,
      expiresAt: new Date(expiresAt * 1000),
    });

    const response = await fetch(`${baseUrl}/admin/users/${target._id}`, {
      method: 'PATCH',
      headers: {
        Cookie: `caderno_token=${token}`,
        Origin: 'http://localhost:5173',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'active' }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'REAUTH_REQUIRED');
    assert.equal(target.status, 'pending');
  });
  const cookie = adminLogin.headers.get('set-cookie').split(';')[0];

  const list = await fetch(`${baseUrl}/admin/users`, { headers: { Cookie: cookie } });
  assert.equal(list.status, 200);
  assert.equal((await list.json()).data.length, 2);

  const approved = await fetch(`${baseUrl}/admin/users/${pending._id}`, {
    method: 'PATCH',
    headers: { Cookie: cookie, Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'active' }),
  });
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).data.status, 'active');

  const nonAdminAccess = await fetch(`${baseUrl}/admin/users`, { headers: { Cookie: pendingCookie } });
  assert.equal(nonAdminAccess.status, 403);
  assert.equal((await nonAdminAccess.json()).error.code, 'FORBIDDEN');

  const selfBlock = await fetch(`${baseUrl}/admin/users/${adminCookie._id}`, {
    method: 'PATCH',
    headers: { Cookie: cookie, Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'blocked' }),
  });
  assert.equal(selfBlock.status, 400);

  const blocked = await fetch(`${baseUrl}/admin/users/${pending._id}`, {
    method: 'PATCH',
    headers: { Cookie: cookie, Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'blocked' }),
  });
  assert.equal(blocked.status, 200);

  const denied = await fetch(`${baseUrl}/people`, { headers: { Cookie: pendingCookie } });
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).error.code, 'UNAUTHORIZED');
});
