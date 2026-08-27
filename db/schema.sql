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
