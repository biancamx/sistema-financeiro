import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

const { redactPortalToken } = await import('../src/middleware/requestLogger.js');

test('redacts the shared portal token while preserving query details', () => {
  assert.equal(
    redactPortalToken('/api/portal/SecretToken123?source=email'),
    '/api/portal/[REDACTED]?source=email',
  );
});

test('leaves non-portal request URLs unchanged', () => {
  assert.equal(redactPortalToken('/api/people?active=true'), '/api/people?active=true');
});
