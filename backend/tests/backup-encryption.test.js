import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBackupCipher, createBackupDecipher, parseBackupKey } from '../src/lib/backupEncryption.js';

test('backup uses authenticated AES-256-GCM and rejects tampering or invalid keys', () => {
  const key = parseBackupKey('00112233445566778899aabbccddeeff'.repeat(2));
  const plaintext = Buffer.from('synthetic backup content');
  const { header, cipher } = createBackupCipher(key, Buffer.from('00112233445566778899aabb', 'hex'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const decipher = createBackupDecipher(key, header, authTag);
  assert.deepEqual(Buffer.concat([decipher.update(ciphertext), decipher.final()]), plaintext);

  const tampered = Buffer.from(ciphertext);
  tampered[0] ^= 0xff;
  const invalidDecipher = createBackupDecipher(key, header, authTag);
  assert.throws(() => {
    invalidDecipher.update(tampered);
    invalidDecipher.final();
  });
  assert.throws(() => parseBackupKey('not-a-key'), /64 caracteres hexadecimais/);
  assert.throws(() => parseBackupKey('00'.repeat(32)), /entropia suficiente/);
});
