import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const envModuleUrl = new URL('../src/config/env.js', import.meta.url).href;

function loadEnv(nodeEnv, overrides = {}) {
  const script = `import(${JSON.stringify(envModuleUrl)})`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: nodeEnv,
      JWT_SECRET: '',
      AI_KEY_SECRET: 'a'.repeat(64),
      DOTENV_CONFIG_PATH: 'missing-env-file-for-test',
      ...overrides,
    },
  });
}

test('requires JWT_SECRET outside test mode', () => {
  for (const nodeEnv of ['development', 'production']) {
    const result = loadEnv(nodeEnv);
    assert.notEqual(result.status, 0, `${nodeEnv} should reject a missing JWT_SECRET`);
    assert.match(result.stderr, /JWT_SECRET/);
  }
});

test('allows an unset JWT_SECRET in test mode', () => {
  const result = loadEnv('test');
  assert.equal(result.status, 0, result.stderr);
});

test('requires a valid AI_KEY_SECRET outside test mode', () => {
  const missing = loadEnv('development', { JWT_SECRET: 'test-jwt-secret', AI_KEY_SECRET: '' });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /AI_KEY_SECRET/);

  const malformed = loadEnv('development', { JWT_SECRET: 'test-jwt-secret', AI_KEY_SECRET: 'not-hex' });
  assert.notEqual(malformed.status, 0);
  assert.match(malformed.stderr, /64 caracteres hexadecimais/);
});

test('requires strong, distinct production JWT and jobs secrets', () => {
  const missingJobsToken = loadEnv('production', {
    JWT_SECRET: '0123456789abcdefghijklmnopqrstuv'.repeat(2),
    AI_KEY_SECRET: '00112233445566778899aabbccddeeff'.repeat(2),
    JOBS_TOKEN: '',
  });
  assert.notEqual(missingJobsToken.status, 0);
  assert.match(missingJobsToken.stderr, /JOBS_TOKEN/);

  const weakJwtSecret = loadEnv('production', {
    JWT_SECRET: 'a'.repeat(64),
    JOBS_TOKEN: 'c'.repeat(64),
    AI_KEY_SECRET: '00112233445566778899aabbccddeeff'.repeat(2),
  });
  assert.notEqual(weakJwtSecret.status, 0);
  assert.match(weakJwtSecret.stderr, /JWT_SECRET deve ser um segredo aleatório/);

  const sameSecrets = loadEnv('production', {
    JWT_SECRET: '0123456789abcdefghijklmnopqrstuv'.repeat(2),
    JOBS_TOKEN: '0123456789abcdefghijklmnopqrstuv'.repeat(2),
    AI_KEY_SECRET: '00112233445566778899aabbccddeeff'.repeat(2),
  });
  assert.notEqual(sameSecrets.status, 0);
  assert.match(sameSecrets.stderr, /JOBS_TOKEN deve ser diferente/);

  const strongSecrets = loadEnv('production', {
    JWT_SECRET: '0123456789abcdefghijklmnopqrstuv'.repeat(2),
    JOBS_TOKEN: 'vutsrqponmlkjihgfedcba9876543210'.repeat(2),
    AI_KEY_SECRET: '00112233445566778899aabbccddeeff'.repeat(2),
  });
  assert.equal(strongSecrets.status, 0, strongSecrets.stderr);

  const weakAiKeySecret = loadEnv('production', {
    JWT_SECRET: '0123456789abcdefghijklmnopqrstuv'.repeat(2),
    JOBS_TOKEN: 'vutsrqponmlkjihgfedcba9876543210'.repeat(2),
    AI_KEY_SECRET: '0'.repeat(64),
  });
  assert.notEqual(weakAiKeySecret.status, 0);
  assert.match(weakAiKeySecret.stderr, /AI_KEY_SECRET deve ser um segredo aleatório/);
});
