import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateShareToken } from '../lib/shareToken.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function columnExists(database, table, column) {
  return database.prepare(`PRAGMA table_info(${table})`).all().some((item) => item.name === column);
}

const MIGRATIONS = [
  {
    name: '006_people_phone',
    run(database) {
      if (!columnExists(database, 'people', 'phone')) {
        database.exec('ALTER TABLE people ADD COLUMN phone TEXT;');
      }
    },
  },
  {
    name: '007_cards_due_and_closing_days',
    run(database) {
      if (!columnExists(database, 'cards', 'due_day')) {
        database.exec('ALTER TABLE cards ADD COLUMN due_day INTEGER DEFAULT 10;');
      }
      if (!columnExists(database, 'cards', 'closing_day')) {
        database.exec('ALTER TABLE cards ADD COLUMN closing_day INTEGER DEFAULT 3;');
      }
    },
  },
  {
    name: '008_people_profile_fields',
    run(database) {
      if (!columnExists(database, 'people', 'email')) database.exec('ALTER TABLE people ADD COLUMN email TEXT;');
      if (!columnExists(database, 'people', 'birth_date')) database.exec('ALTER TABLE people ADD COLUMN birth_date TEXT;');
      if (!columnExists(database, 'people', 'pix_key')) database.exec('ALTER TABLE people ADD COLUMN pix_key TEXT;');
      if (!columnExists(database, 'people', 'avatar')) database.exec('ALTER TABLE people ADD COLUMN avatar TEXT;');
      if (!columnExists(database, 'people', 'notes')) database.exec('ALTER TABLE people ADD COLUMN notes TEXT;');
    },
  },
  {
    name: '009_birthday_person_link',
    run(database) {
      if (!columnExists(database, 'birthdays', 'person_id')) {
        database.exec('ALTER TABLE birthdays ADD COLUMN person_id INTEGER REFERENCES people(id) ON DELETE CASCADE;');
      }
      database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_birthdays_person ON birthdays (person_id) WHERE person_id IS NOT NULL;');
    },
  },
  {
    name: '010_people_share_token',
    run(database) {
      if (!columnExists(database, 'people', 'share_token')) {
        database.exec('ALTER TABLE people ADD COLUMN share_token TEXT;');
      }

      const existingPeople = database.prepare('SELECT id FROM people WHERE share_token IS NULL OR length(share_token) > 12').all();
      const updateToken = database.prepare('UPDATE people SET share_token = ? WHERE id = ?');
      for (const person of existingPeople) {
        updateToken.run(generateShareToken(database), person.id);
      }

      database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_people_share_token ON people (share_token);');
    },
  },
  {
    name: '011_reminder_settings',
    run(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS reminder_settings (
          user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
          trigger_day INTEGER NOT NULL DEFAULT 5 CHECK (trigger_day BETWEEN 1 AND 31),
          trigger_hour INTEGER NOT NULL DEFAULT 9 CHECK (trigger_hour BETWEEN 0 AND 23),
          auto_send INTEGER NOT NULL DEFAULT 0 CHECK (auto_send IN (0, 1)),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    name: '012_card_closing_day_equal_policy',
    run(database) {
      if (!columnExists(database, 'cards', 'closing_day_equal')) {
        database.exec("ALTER TABLE cards ADD COLUMN closing_day_equal TEXT NOT NULL DEFAULT 'next'");
      }
    },
  },
  {
    name: '013_vehicle_sale_details',
    run(database) {
      if (!columnExists(database, 'vehicles', 'sold_date')) database.exec('ALTER TABLE vehicles ADD COLUMN sold_date TEXT');
      if (!columnExists(database, 'vehicles', 'sold_value_cents')) database.exec('ALTER TABLE vehicles ADD COLUMN sold_value_cents INTEGER');
    },
  },
  {
    name: '014_cash_ledger_down_payment',
    run(database) {
      if (!columnExists(database, 'cash_entries', 'down_payment_cents')) {
        database.exec('ALTER TABLE cash_entries ADD COLUMN down_payment_cents INTEGER NOT NULL DEFAULT 0');
      }
    },
  },
  {
    name: '015_vehicle_owner',
    run(database) {
      if (!columnExists(database, 'vehicles', 'owner_id')) {
        database.exec('ALTER TABLE vehicles ADD COLUMN owner_id INTEGER REFERENCES people(id) ON DELETE SET NULL');
      }
    },
  },
  {
    name: '016_portal_contact_person',
    run(database) {
      if (!columnExists(database, 'users', 'portal_contact_person_id')) {
        database.exec('ALTER TABLE users ADD COLUMN portal_contact_person_id INTEGER REFERENCES people(id) ON DELETE SET NULL');
      }
    },
  },
];

export function openDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  migrate(db);
  return db;
}

/** Ajustes para bancos criados por versões anteriores (CREATE TABLE IF NOT EXISTS não altera tabelas existentes). */
function migrate(db) {
  const cols = db.prepare('PRAGMA table_info(purchases)').all().map((c) => c.name);
  if (!cols.includes('shared_group')) db.exec('ALTER TABLE purchases ADD COLUMN shared_group TEXT');
  if (!cols.includes('observation')) db.exec("ALTER TABLE purchases ADD COLUMN observation TEXT NOT NULL DEFAULT ''");
  if (!cols.includes('vehicle_expense_id')) db.exec('ALTER TABLE purchases ADD COLUMN vehicle_expense_id INTEGER REFERENCES vehicle_expenses(id) ON DELETE CASCADE');
  db.exec('CREATE INDEX IF NOT EXISTS idx_purch_shared ON purchases (user_id, shared_group)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_purch_vehicle_expense ON purchases (vehicle_expense_id)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_purch_vehicle_expense_person ON purchases (vehicle_expense_id, person_id) WHERE vehicle_expense_id IS NOT NULL');

  const vehicleExpenseCols = db.prepare('PRAGMA table_info(vehicle_expenses)').all().map((c) => c.name);
  if (!vehicleExpenseCols.includes('payment_method')) {
    db.exec("ALTER TABLE vehicle_expenses ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash'");
  }
  if (!vehicleExpenseCols.includes('request_id')) db.exec('ALTER TABLE vehicle_expenses ADD COLUMN request_id TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_vexp_request ON vehicle_expenses (user_id, request_id) WHERE request_id IS NOT NULL');

  const cardCols = db.prepare('PRAGMA table_info(cards)').all().map((c) => c.name);
  if (!cardCols.includes('issuer')) db.exec("ALTER TABLE cards ADD COLUMN issuer TEXT NOT NULL DEFAULT 'Outro'");
  if (!cardCols.includes('brand')) db.exec("ALTER TABLE cards ADD COLUMN brand TEXT NOT NULL DEFAULT 'Outro'");
  if (!cardCols.includes('last_four')) db.exec('ALTER TABLE cards ADD COLUMN last_four TEXT');
  if (!cardCols.includes('color')) db.exec("ALTER TABLE cards ADD COLUMN color TEXT NOT NULL DEFAULT '#0f6b66'");
  if (!cardCols.includes('image_data')) db.exec('ALTER TABLE cards ADD COLUMN image_data TEXT');
  if (!cardCols.includes('owner_id')) db.exec('ALTER TABLE cards ADD COLUMN owner_id INTEGER REFERENCES people(id) ON DELETE SET NULL');
  if (!cardCols.includes('closing_day_equal')) {
    db.exec("ALTER TABLE cards ADD COLUMN closing_day_equal TEXT NOT NULL DEFAULT 'next'");
  }

  const installmentCols = db.prepare('PRAGMA table_info(installments)').all().map((c) => c.name);
  if (!installmentCols.includes('paid_amount')) {
    db.exec('ALTER TABLE installments ADD COLUMN paid_amount REAL NOT NULL DEFAULT 0');
    db.exec('UPDATE installments SET paid_amount = amount WHERE paid = 1');
  }

  for (const migration of MIGRATIONS) migration.run(db);
}
