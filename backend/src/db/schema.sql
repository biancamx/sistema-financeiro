-- Camada "Database & Storage". Toda tabela de dados tem user_id (isolamento por usuário / "RLS" na aplicação).
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  picture TEXT,
  password_hash TEXT,
  google_sub TEXT UNIQUE,
  provider TEXT NOT NULL DEFAULT 'password',   -- password | google | local
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  birth_date TEXT,
  pix_key TEXT,
  avatar TEXT,
  notes TEXT,
  share_token TEXT,
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  limit_amount REAL NOT NULL DEFAULT 0,
  due_day INTEGER DEFAULT 10,
  closing_day INTEGER DEFAULT 3,
  issuer TEXT NOT NULL DEFAULT 'Outro',
  brand TEXT NOT NULL DEFAULT 'Outro',
  last_four TEXT,
  color TEXT NOT NULL DEFAULT '#0f6b66',
  image_data TEXT,
  owner_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE (user_id, name)
);

-- "Banco de Dados" da planilha: uma compra + suas parcelas (uma linha por mês)
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  purchase_date TEXT,
  total REAL NOT NULL,
  installments_count INTEGER NOT NULL DEFAULT 1,
  -- Compra dividida entre várias pessoas: cada participante tem a sua própria compra (com a sua fatia das parcelas),
  -- e todas compartilham o mesmo shared_group. NULL = compra individual.
  shared_group TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS installments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount REAL NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0,
  paid_amount REAL NOT NULL DEFAULT 0
);

-- Planilha mensal por pessoa/ano (abas "Financeiro Pessoa 01", "Pessoa 07"...)
CREATE TABLE IF NOT EXISTS budget_sheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  UNIQUE (user_id, person_id, year)
);

CREATE TABLE IF NOT EXISTS budget_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sheet_id INTEGER NOT NULL REFERENCES budget_sheets(id) ON DELETE CASCADE,
  section TEXT NOT NULL,
  label TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  receivable_from TEXT,
  obs TEXT
);

CREATE TABLE IF NOT EXISTS budget_cells (
  row_id INTEGER NOT NULL REFERENCES budget_rows(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  value REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (row_id, month)
);

-- Linha "Status" (pendente/pago) por pessoa e mês
CREATE TABLE IF NOT EXISTS month_status (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  status TEXT NOT NULL CHECK (status IN ('pending','paid')),
  PRIMARY KEY (user_id, person_id, year, month)
);

CREATE TABLE IF NOT EXISTS reminder_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  trigger_day INTEGER NOT NULL DEFAULT 5 CHECK (trigger_day BETWEEN 1 AND 31),
  trigger_hour INTEGER NOT NULL DEFAULT 9 CHECK (trigger_hour BETWEEN 0 AND 23),
  auto_send INTEGER NOT NULL DEFAULT 0 CHECK (auto_send IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS birthdays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  day INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  person_id INTEGER REFERENCES people(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inst_user_period ON installments (user_id, year, month);
CREATE INDEX IF NOT EXISTS idx_inst_purchase ON installments (purchase_id);
CREATE INDEX IF NOT EXISTS idx_purch_user ON purchases (user_id, person_id, card_id);
CREATE INDEX IF NOT EXISTS idx_rows_sheet ON budget_rows (sheet_id);
CREATE INDEX IF NOT EXISTS idx_bday_user ON birthdays (user_id);

-- ───────── Gestão de Veículos (frota + histórico de gastos rastreável) ─────────
CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'car' CHECK (kind IN ('car','motorcycle','utility','other')),
  model TEXT NOT NULL,
  plate TEXT NOT NULL,                       -- normalizada: maiúscula, sem hífen/espaço
  year INTEGER,
  purchase_value REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','sold')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, plate)
);

-- Um gasto. payer_id = quem pagou (e, se for individual, quem assume). As fatias ficam em vehicle_expense_shares.
-- Pessoa usada em gasto não pode ser apagada (sem CASCADE; a API devolve 409): o histórico precisa continuar rastreável.
-- (NO ACTION, e não RESTRICT, para que apagar o usuário inteiro ainda funcione: a checagem é no fim do comando.)
CREATE TABLE IF NOT EXISTS vehicle_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  expense_date TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL CHECK (amount >= 1),
  km INTEGER CHECK (km IS NULL OR km >= 0),
  payer_id INTEGER NOT NULL REFERENCES people(id),
  shared INTEGER NOT NULL DEFAULT 0,
  split_mode TEXT NOT NULL DEFAULT 'equal' CHECK (split_mode IN ('equal','percent','amount')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Quanto cada pessoa assume de cada gasto (individual = 1 linha; compartilhado = 1 por membro). Soma = amount, no centavo.
CREATE TABLE IF NOT EXISTS vehicle_expense_shares (
  expense_id INTEGER NOT NULL REFERENCES vehicle_expenses(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id),
  amount REAL NOT NULL,
  PRIMARY KEY (expense_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_veh_user ON vehicles (user_id);
CREATE INDEX IF NOT EXISTS idx_vexp_vehicle ON vehicle_expenses (user_id, vehicle_id, expense_date);
CREATE INDEX IF NOT EXISTS idx_vexp_payer ON vehicle_expenses (payer_id);
CREATE INDEX IF NOT EXISTS idx_vshare_person ON vehicle_expense_shares (person_id);
