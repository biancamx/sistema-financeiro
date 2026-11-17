import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-rate-limits';
process.env.RATE_LIMIT_MAX = '100';
process.env.ADMIN_EMAIL = '';

const [{ createApp }, { User }, { env }] = await Promise.all([
  import('../src/app.js'),
  import('../src/models/User.js'),
  import('../src/config/env.js'),
]);

const originalFindById = User.findById;
const users = new Map();
let server;
let baseUrl;

User.findById = (id) => ({
  select: async () => users.get(id.toString()) || null,
});

function createUserToken() {
  const id = new mongoose.Types.ObjectId();
  users.set(id.toString(), {
    _id: id,
    email: `${id}@example.com`,
    name: 'Rate limit test',
    avatar: null,
    status: 'active',
    role: 'user',
  });
  return jwt.sign({ sub: id.toString() }, env.jwtSecret);
}

function forwardedIp(index) {
  return `192.0.2.${index}`;
}

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  User.findById = originalFindById;
});

test('applies the global API rate limit', async () => {
  for (let request = 0; request < 100; request += 1) {
    const response = await fetch(`${baseUrl}/system/health`, {
      headers: { 'X-Forwarded-For': '203.0.113.1' },
    });
    assert.equal(response.status, 200);
  }
  const limited = await fetch(`${baseUrl}/system/health`, {
    headers: { 'X-Forwarded-For': '203.0.113.1' },
  });
  assert.equal(limited.status, 429);
});

test('limits regular request bodies to 1 MB and retains the import allowance', async () => {
  const body = JSON.stringify({ value: 'x'.repeat(1_100_000) });
  const regular = await fetch(`${baseUrl}/people`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '203.0.113.2',
    },
    body,
  });
  assert.equal(regular.status, 413);

  const importRequest = await fetch(`${baseUrl}/import/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '203.0.113.3',
    },
    body,
  });
  assert.equal(importRequest.status, 401);
});

test('limits assistant and import previews per authenticated user', async () => {
  const assistantUser = createUserToken();
  for (let request = 0; request < 20; request += 1) {
    const response = await fetch(`${baseUrl}/assistant/chat`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${assistantUser}`,
        'Content-Type': 'application/json',
        'X-Forwarded-For': forwardedIp(request + 1),
      },
      body: '{}',
    });
    assert.equal(response.status, 400);
  }
  const assistantLimited = await fetch(`${baseUrl}/assistant/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${assistantUser}`,
      'Content-Type': 'application/json',
      'X-Forwarded-For': forwardedIp(21),
    },
    body: '{}',
  });
  assert.equal(assistantLimited.status, 429);

  const assistantOtherUser = createUserToken();
  const assistantOtherUserResponse = await fetch(`${baseUrl}/assistant/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${assistantOtherUser}`,
      'Content-Type': 'application/json',
      'X-Forwarded-For': forwardedIp(21),
    },
    body: '{}',
  });
  assert.equal(assistantOtherUserResponse.status, 400);

  const importUser = createUserToken();
  for (let request = 0; request < 10; request += 1) {
    const response = await fetch(`${baseUrl}/import/preview`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${importUser}`,
        'Content-Type': 'application/json',
        'X-Forwarded-For': forwardedIp(request + 30),
      },
      body: '{}',
    });
    assert.equal(response.status, 400);
  }
  const importLimited = await fetch(`${baseUrl}/import/preview`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${importUser}`,
      'Content-Type': 'application/json',
      'X-Forwarded-For': forwardedIp(40),
    },
    body: '{}',
  });
  assert.equal(importLimited.status, 429);

  const importOtherUser = createUserToken();
  const importOtherUserResponse = await fetch(`${baseUrl}/import/preview`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${importOtherUser}`,
      'Content-Type': 'application/json',
      'X-Forwarded-For': forwardedIp(40),
    },
    body: '{}',
  });
  assert.equal(importOtherUserResponse.status, 400);
});

test('rate limits public portal access by IP', async () => {
  for (let request = 0; request < 60; request += 1) {
    const response = await fetch(`${baseUrl}/portal/invalid`, {
      headers: { 'X-Forwarded-For': '203.0.113.4' },
    });
    assert.equal(response.status, 404);
  }
  const limited = await fetch(`${baseUrl}/portal/invalid`, {
    headers: { 'X-Forwarded-For': '203.0.113.4' },
  });
  assert.equal(limited.status, 429);
});
