import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

test('rotas do sistema existem somente sob /api/system', async (t) => {
  const server = createApp().listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  const officialHealth = await fetch(`${baseUrl}/system/health`);
  assert.equal(officialHealth.status, 200);
  assert.equal((await officialHealth.json()).status, 'ok');
  assert.equal(officialHealth.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
  const csp = officialHealth.headers.get('content-security-policy');
  assert.match(csp, /script-src[^;]*'self'[^;]*https:\/\/accounts\.google\.com\/gsi\/client/);
  assert.match(csp, /frame-src[^;]*'self'[^;]*https:\/\/accounts\.google\.com\/gsi\//);
  assert.match(csp, /connect-src[^;]*'self'[^;]*https:\/\/accounts\.google\.com\/gsi\//);

  assert.equal((await fetch(`${baseUrl}/health`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/system/system/health`)).status, 401);
});
