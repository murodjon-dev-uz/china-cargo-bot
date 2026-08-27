CREATE TABLE IF NOT EXISTS clients (
  telegram_id BIGINT PRIMARY KEY,
  first_name TEXT,
  full_name TEXT,
  phone TEXT UNIQUE,
  registration_state TEXT NOT NULL DEFAULT 'AWAITING_NAME' CHECK (registration_state IN ('AWAITING_NAME','AWAITING_PHONE','REGISTERED')),
  registration_completed_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone) WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS orders (
  order_number TEXT PRIMARY KEY,
  cargo_description TEXT,
  route TEXT,
  eta_date DATE,
  current_status TEXT,
  current_comment TEXT,
  stage TEXT NOT NULL DEFAULT 'AT_FACTORY' CHECK (stage IN ('AT_FACTORY', 'IN_TRANSIT', 'DELIVERED')),
  telegram_id BIGINT REFERENCES clients(telegram_id) ON DELETE SET NULL,
  client_name TEXT,
  bound_phone TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_telegram_id ON orders(telegram_id);
CREATE INDEX IF NOT EXISTS idx_orders_bound_phone ON orders(bound_phone);

ALTER TABLE clients ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS registration_state TEXT NOT NULL DEFAULT 'AWAITING_NAME';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS registration_completed_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone) WHERE phone IS NOT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS bound_phone TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_bound_phone ON orders(bound_phone);
DROP INDEX IF EXISTS idx_clients_username;
DROP INDEX IF EXISTS idx_orders_bound_username;
ALTER TABLE clients DROP COLUMN IF EXISTS username;
ALTER TABLE orders DROP COLUMN IF EXISTS bound_username;

CREATE TABLE IF NOT EXISTS status_history (
  id BIGSERIAL PRIMARY KEY,
  order_number TEXT NOT NULL REFERENCES orders(order_number) ON DELETE CASCADE,
  status_text TEXT NOT NULL,
  comment TEXT,
  changed_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_order ON status_history(order_number, changed_at);

CREATE TABLE IF NOT EXISTS sync_log (
  order_number TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL,
  result TEXT NOT NULL,
  PRIMARY KEY (order_number, content_hash)
);

CREATE TABLE IF NOT EXISTS digest_log (
  digest_date DATE PRIMARY KEY,
  sent_at TIMESTAMPTZ NOT NULL,
  clients INTEGER NOT NULL DEFAULT 0,
  delivered INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS manager_actions_log (
  id BIGSERIAL PRIMARY KEY,
  manager_telegram_id BIGINT NOT NULL,
  order_number TEXT NOT NULL,
  new_status_text TEXT,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

-- Access list mirrored from the "Контакты" sheet. A phone must be present
-- here for its owner to use the bot at all: registration checks it, and so
-- does every later interaction, so deleting a row in the sheet revokes
-- access on the client's next message. The sheet is reconciled wholesale on
-- every sync, which is what makes deletions detectable.
CREATE TABLE IF NOT EXISTS contacts (
  phone TEXT PRIMARY KEY,
  full_name TEXT,
  sheet_row INTEGER,
  synced_at TIMESTAMPTZ NOT NULL
);

-- The name step is gone: /start now asks for the phone straight away, and
-- the client's name comes from the "Контакты" sheet instead of being typed.
ALTER TABLE clients ALTER COLUMN registration_state SET DEFAULT 'AWAITING_PHONE';
UPDATE clients SET registration_state = 'AWAITING_PHONE' WHERE registration_state = 'AWAITING_NAME';

-- Managers are just another kind of contact: they log in with their phone
-- exactly like clients do, and the "Менеджеры" sheet is their access list.
-- Keeping both roles in one table means one authorization query, and makes
-- it impossible for a number to be a client and a manager at once.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'client';
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_role_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_role_check CHECK (role IN ('client','manager'));
CREATE INDEX IF NOT EXISTS idx_contacts_role ON contacts(role);

-- Shipment particulars. "route" stays as the legacy free-text field and is
-- only rendered when origin/destination are empty, so old rows keep working.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS origin TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS destination TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(12,3);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS volume_m3 NUMERIC(12,3);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS packages INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS price NUMERIC(14,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS currency TEXT;

-- Payment ledger mirrored from the "Оплаты" sheet: a client pays in parts, so
-- what matters is the running total against the order's price, not a single
-- "paid" flag. No foreign key on purpose — a payment can be entered before
-- the order row exists, and losing it to a cascade would be worse than an
-- orphan row that resolves itself on the next sync.
CREATE TABLE IF NOT EXISTS payments (
  id BIGSERIAL PRIMARY KEY,
  order_number TEXT NOT NULL,
  paid_on DATE,
  amount NUMERIC(14,2) NOT NULL,
  currency TEXT,
  note TEXT,
  sheet_row INTEGER,
  synced_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_number);
