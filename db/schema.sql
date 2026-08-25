CREATE TABLE IF NOT EXISTS clients (
  telegram_id     INTEGER PRIMARY KEY,
  username        TEXT,
  first_name      TEXT,
  first_seen_at   TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clients_username ON clients(username COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS orders (
  order_number         TEXT PRIMARY KEY,
  cargo_description    TEXT,
  route                 TEXT,
  eta_date              TEXT,
  current_status       TEXT,
  current_comment      TEXT,
  stage                TEXT NOT NULL DEFAULT 'AT_FACTORY',
  telegram_id          INTEGER REFERENCES clients(telegram_id),
  bound_username       TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_telegram_id ON orders(telegram_id);
CREATE INDEX IF NOT EXISTS idx_orders_bound_username ON orders(bound_username COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS status_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number  TEXT NOT NULL REFERENCES orders(order_number),
  status_text   TEXT NOT NULL,
  comment       TEXT,
  changed_at    TEXT NOT NULL,
  source        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_order ON status_history(order_number, changed_at);

CREATE TABLE IF NOT EXISTS sync_log (
  order_number   TEXT NOT NULL,
  content_hash   TEXT NOT NULL,
  processed_at   TEXT NOT NULL,
  result         TEXT NOT NULL,
  PRIMARY KEY (order_number, content_hash)
);

-- One row per day the digest went out, so restarts (or a catch-up run after
-- the laptop was asleep at 09:00) can't send the same morning twice.
CREATE TABLE IF NOT EXISTS digest_log (
  digest_date  TEXT PRIMARY KEY,   -- YYYY-MM-DD in the configured timezone
  sent_at      TEXT NOT NULL,
  clients      INTEGER NOT NULL DEFAULT 0,
  delivered    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS manager_actions_log (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  manager_telegram_id   INTEGER NOT NULL,
  order_number          TEXT NOT NULL,
  new_status_text       TEXT,
  comment               TEXT,
  created_at            TEXT NOT NULL
);
