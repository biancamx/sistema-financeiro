import 'dotenv/config';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createBackupDecipher, BACKUP_HEADER_SIZE, BACKUP_TAG_SIZE, parseBackupKey } from '../src/lib/backupEncryption.js';

if (process.env.NODE_ENV === 'production' || process.env.RESTORE_TARGET_ACK !== 'isolated-nonproduction') {
  throw new Error('Restauração bloqueada. Use um destino isolado e confirme RESTORE_TARGET_ACK=isolated-nonproduction.');
}
const uri = process.env.RESTORE_MONGODB_URI;
if (!uri) throw new Error('Defina RESTORE_MONGODB_URI para o MongoDB isolado de restauração.');
const file = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Informe o caminho para o arquivo .archive.gz.enc.');

const key = parseBackupKey();
const handle = await open(file, 'r');
try {
  const { size } = await handle.stat();
  if (size <= BACKUP_HEADER_SIZE + BACKUP_TAG_SIZE) throw new Error('Arquivo de backup vazio ou truncado.');
  const header = Buffer.alloc(BACKUP_HEADER_SIZE);
  const authTag = Buffer.alloc(BACKUP_TAG_SIZE);
  await handle.read(header, 0, header.length, 0);
  await handle.read(authTag, 0, authTag.length, size - authTag.length);
  const decipher = createBackupDecipher(key, header, authTag);
  const restore = spawn('mongorestore', [
    '--uri', uri,
    '--archive',
    '--gzip',
    '--nsFrom=*.*',
    '--nsTo=security_restore_test.*',
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const exit = new Promise((resolve, reject) => {
    restore.once('error', reject);
    restore.once('close', (code) => code === 0
      ? resolve()
      : reject(new Error(`mongorestore terminou com código ${code}`)));
  });
  await Promise.all([
    pipeline(
      fs.createReadStream(file, { start: BACKUP_HEADER_SIZE, end: size - BACKUP_TAG_SIZE - 1 }),
      decipher,
      restore.stdin,
    ),
    exit,
  ]);
  console.log('Backup restaurado no banco isolado security_restore_test.');
} finally {
  await handle.close();
}
