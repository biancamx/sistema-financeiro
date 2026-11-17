import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';

const ALGORITHM = 'aes-256-gcm';

export function encryptAiApiKey(apiKey) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, Buffer.from(env.aiKeySecret, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${authTag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptAiApiKey(value) {
  const [version, ivValue, tagValue, encryptedValue] = String(value).split(':');
  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) {
    throw new Error('A configuração criptografada da IA está inválida.');
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, Buffer.from(env.aiKeySecret, 'hex'), Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Não foi possível descriptografar a configuração da IA.');
  }
}
