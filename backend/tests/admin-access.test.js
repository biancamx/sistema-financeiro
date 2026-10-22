import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-access-control';
process.env.ADMIN_EMAIL = 'admin@example.com';
process.env.ALLOWED_DOMAINS = '';
process.env.AUTH_RATE_LIMIT_MAX = '1000';

const [{ createApp }, { User }] = await Promise.all([
  import('../src/app.js'),
  import('../src/models/User.js'),
]);

let server;
let baseUrl;
const originalFindOne = User.findOne;
const originalCreate = User.create;
const originalFindById = User.findById;
const originalFind = User.find;
const users = new Map();
let pendingCookie;

function fakeQuery(user) {
  return { select: async () => user || null };
}

before(async () => {
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

test('normal accounts await approval while configured admin is promoted automatically', async () => {
  const regular = await register('Usuário Pendente', 'pending@example.com');
  assert.equal(regular.response.status, 201);
  assert.equal(regular.body.data.user.status, 'pending');
  assert.equal(regular.body.data.user.role, 'user');
  pendingCookie = regular.cookie;

  const pendingRequest = await fetch(`${baseUrl}/people`, { headers: { Cookie: regular.cookie } });
  assert.equal(pendingRequest.status, 403);
  assert.equal((await pendingRequest.json()).error.code, 'ACCOUNT_PENDING');

  const admin = await register('Administradora', 'ADMIN@example.com');
  assert.equal(admin.response.status, 201);
  assert.equal(admin.body.data.user.status, 'active');
  assert.equal(admin.body.data.user.role, 'admin');
});

test('admin can list and approve users; blocked users remain denied', async () => {
  const pending = users.get('pending@example.com');
  const adminCookie = [...users.values()].find((user) => user.role === 'admin');
  const adminLogin = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminCookie.email, password: 'senha-segura-123' }),
  });
  const cookie = adminLogin.headers.get('set-cookie').split(';')[0];

  const list = await fetch(`${baseUrl}/admin/users`, { headers: { Cookie: cookie } });
  assert.equal(list.status, 200);
  assert.equal((await list.json()).data.length, 2);

  const approved = await fetch(`${baseUrl}/admin/users/${pending._id}`, {
    method: 'PATCH',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'active' }),
  });
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).data.status, 'active');

  const nonAdminAccess = await fetch(`${baseUrl}/admin/users`, { headers: { Cookie: pendingCookie } });
  assert.equal(nonAdminAccess.status, 403);
  assert.equal((await nonAdminAccess.json()).error.code, 'FORBIDDEN');

  const selfBlock = await fetch(`${baseUrl}/admin/users/${adminCookie._id}`, {
    method: 'PATCH',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'blocked' }),
  });
  assert.equal(selfBlock.status, 400);

  const blocked = await fetch(`${baseUrl}/admin/users/${pending._id}`, {
    method: 'PATCH',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'blocked' }),
  });
  assert.equal(blocked.status, 200);

  const denied = await fetch(`${baseUrl}/people`, { headers: { Cookie: pendingCookie } });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, 'ACCOUNT_PENDING');
});
