import 'dotenv/config';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { appendFile, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createBackupCipher, parseBackupKey } from '../src/lib/backupEncryption.js';

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('Defina MONGODB_URI antes de criar o backup.');
const key = parseBackupKey();

const dir = path.resolve('backups');
await mkdir(dir, { recursive: true });
const filename = `financeiro-${new Date().toISOString().replace(/[:.]/g, '-')}.archive.gz.enc`;
const file = path.join(dir, filename);
const temporaryFile = `${file}.tmp`;
const { header, cipher } = createBackupCipher(key);

try {
  const dump = spawn('mongodump', ['--uri', uri, '--archive', '--gzip'], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const exit = new Promise((resolve, reject) => {
    dump.once('error', reject);
    dump.once('close', (code) => code === 0
      ? resolve()
      : reject(new Error(`mongodump terminou com código ${code}`)));
  });
  const output = fs.createWriteStream(temporaryFile, { flags: 'wx' });
  await new Promise((resolve, reject) => output.write(header, (error) => error ? reject(error) : resolve()));
  await Promise.all([pipeline(dump.stdout, cipher, output), exit]);
  await appendFile(temporaryFile, cipher.getAuthTag());
  await rename(temporaryFile, file);
} catch (error) {
  await rm(temporaryFile, { force: true });
  throw new Error(`Falha ao criar backup MongoDB. Verifique se o MongoDB Database Tools está instalado e acessível: ${error.message}`);
}

console.log('Backup MongoDB criado:', file);
