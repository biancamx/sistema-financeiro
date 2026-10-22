import 'dotenv/config';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('Defina MONGODB_URI antes de criar o backup.');

const dir = path.resolve('backups');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `financeiro-${new Date().toISOString().replace(/[:.]/g, '-')}.archive.gz`);

try {
  await new Promise((resolve, reject) => {
    const dump = spawn('mongodump', ['--uri', uri, `--archive=${file}`, '--gzip'], { stdio: 'inherit' });
    dump.once('error', reject);
    dump.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`mongodump terminou com código ${code}`));
    });
  });
} catch (error) {
  fs.rmSync(file, { force: true });
  throw new Error(`Falha ao criar backup MongoDB. Verifique se o MongoDB Database Tools está instalado e acessível: ${error.message}`);
}

const old = fs.readdirSync(dir)
  .filter((name) => name.endsWith('.archive.gz'))
  .sort()
  .reverse()
  .slice(14);
for (const name of old) fs.rmSync(path.join(dir, name));
console.log('Backup MongoDB criado:', file);
