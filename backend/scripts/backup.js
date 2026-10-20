// Backup consistente do SQLite (funciona com o servidor rodando):  npm run backup
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { env } from '../src/config/env.js';

const dir = path.resolve('backups');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `financeiro-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
const db = new Database(env.dbPath, { readonly: true });
await db.backup(file);
db.close();
// mantém só os 14 mais recentes
const old = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort().reverse().slice(14);
for (const f of old) fs.rmSync(path.join(dir, f));
console.log('Backup criado:', file);
