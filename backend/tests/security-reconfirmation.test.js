import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-security-reconfirmation';
process.env.AI_KEY_SECRET = 'a'.repeat(64);

const { requireRecentAuth } = await import('../src/middleware/auth.js');

test('critical operations reject missing, stale, and future authentication timestamps', () => {
  const requireRecent = requireRecentAuth();
  const now = Math.floor(Date.now() / 1000);
  const invoke = (authIssuedAt) => {
    let error;
    let called = false;
    requireRecent({ authIssuedAt }, null, (nextError) => {
      error = nextError;
      called = true;
    });
    return { error, called };
  };

  assert.equal(invoke(now).called, true);
  assert.equal(invoke(now - 300).called, true);

  for (const issuedAt of [undefined, now - 301, now + 1]) {
    const result = invoke(issuedAt);
    assert.equal(result.called, true);
    assert.equal(result.error.status, 403);
    assert.equal(result.error.code, 'REAUTH_REQUIRED');
  }
});
