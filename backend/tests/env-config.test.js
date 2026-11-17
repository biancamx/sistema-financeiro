import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const envModuleUrl = new URL('../src/config/env.js', import.meta.url).href;

function loadEnv(nodeEnv) {
  const script = `import(${JSON.stringify(envModuleUrl)})`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: nodeEnv,
      JWT_SECRET: '',
      DOTENV_CONFIG_PATH: 'missing-env-file-for-test',
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
