import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const BACKUP_HEADER_SIZE = 17;
export const BACKUP_TAG_SIZE = 16;
const MAGIC = Buffer.from('CCBK');

export function parseBackupKey(value = process.env.BACKUP_ENCRYPTION_KEY) {
  if (typeof value !== 'string' || !/^[\da-f]{64}$/i.test(value)) {
    throw new Error('BACKUP_ENCRYPTION_KEY deve conter exatamente 64 caracteres hexadecimais.');
  }
  const key = Buffer.from(value, 'hex');
  if (new Set(key).size < 12) {
    throw new Error('BACKUP_ENCRYPTION_KEY não possui entropia suficiente.');
  }
  return key;
}

export function createBackupCipher(key, iv = randomBytes(12)) {
  if (key.length !== 32 || iv.length !== 12) throw new Error('Chave ou nonce AES-GCM inválido.');
  const header = Buffer.concat([MAGIC, Buffer.from([1]), iv]);
  return { header, cipher: createCipheriv('aes-256-gcm', key, iv) };
}

export function createBackupDecipher(key, header, authTag) {
  if (key.length !== 32 || header.length !== BACKUP_HEADER_SIZE || authTag.length !== BACKUP_TAG_SIZE
    || !header.subarray(0, 4).equals(MAGIC) || header[4] !== 1) {
    throw new Error('Arquivo de backup criptografado inválido ou incompatível.');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(5));
  decipher.setAuthTag(authTag);
  return decipher;
}
