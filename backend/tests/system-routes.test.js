import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-system-routes';

const { createApp } = await import('../src/app.js');

test('rotas do sistema existem somente sob /api/system', async (t) => {
  const server = createApp().listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  const officialHealth = await fetch(`${baseUrl}/system/health`);
  assert.equal(officialHealth.status, 200);
  assert.equal((await officialHealth.json()).status, 'ok');
  assert.ok(officialHealth.headers.get('x-request-id'));
  assert.equal(officialHealth.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
  const csp = officialHealth.headers.get('content-security-policy');
  assert.match(csp, /script-src[^;]*'self'[^;]*https:\/\/accounts\.google\.com\/gsi\/client/);
  assert.match(csp, /frame-src[^;]*'self'[^;]*https:\/\/accounts\.google\.com\/gsi\//);
  assert.match(csp, /connect-src[^;]*'self'[^;]*https:\/\/accounts\.google\.com\/gsi\//);
  assert.match(csp, /img-src[^;]*blob:[^;]*https:\/\/lh3\.googleusercontent\.com[^;]*https:\/\/\*\.googleusercontent\.com/);

  const unauthenticated = await fetch(`${baseUrl}/health`);
  const unauthenticatedBody = await unauthenticated.json();
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticatedBody.error.requestId, unauthenticated.headers.get('x-request-id'));
  assert.equal((await fetch(`${baseUrl}/system/system/health`)).status, 401);

  const missingRoute = await fetch(new URL('/not-a-route', baseUrl), { method: 'POST' });
  const missingBody = await missingRoute.json();
  assert.equal(missingRoute.status, 404);
  assert.equal(missingBody.error.code, 'NOT_FOUND');
  assert.equal(missingBody.error.requestId, missingRoute.headers.get('x-request-id'));
});
