import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'development';
process.env.JWT_SECRET = 'test-secret-for-auth-routes';
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
const users = new Map();

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

  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  server.close();
  User.findOne = originalFindOne;
  User.create = originalCreate;
  User.findById = originalFindById;
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
  assert.ok(registration.headers.get('set-cookie')?.includes('caderno_token='));
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
