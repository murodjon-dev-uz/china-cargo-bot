const crypto = require('node:crypto');
const db = require('./db');

function nowIso() {
  return new Date().toISOString();
}

function withTransaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function contentHash(statusCode, comment) {
  return crypto
    .createHash('sha256')
    .update(`${statusCode}|${comment || ''}`)
    .digest('hex');
}

// --- clients ---

function upsertClient({ telegramId, username, firstName }) {
  const now = nowIso();
  db.prepare(
    `INSERT INTO clients (telegram_id, username, first_name, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(telegram_id) DO UPDATE SET
       username = excluded.username,
       first_name = excluded.first_name,
       last_seen_at = excluded.last_seen_at`
  ).run(telegramId, username || null, firstName || null, now, now);
}

function findClientByUsername(username) {
  if (!username) return undefined;
  return db
    .prepare('SELECT * FROM clients WHERE username = ? COLLATE NOCASE')
    .get(normalizeUsername(username));
}

function normalizeUsername(raw) {
  return String(raw).trim().replace(/^@/, '');
}

// --- status catalog ---

function listStatusCatalog() {
  return db.prepare('SELECT * FROM status_catalog ORDER BY sort_order').all();
}

function getStatus(code) {
  return db.prepare('SELECT * FROM status_catalog WHERE code = ?').get(code);
}

function isValidStatusCode(code) {
  return !!getStatus(code);
}

// --- orders ---

function findOrder(orderNumber) {
  return db.prepare('SELECT * FROM orders WHERE order_number = ?').get(orderNumber);
}

function listOrdersForClient(telegramId) {
  return db
    .prepare(
      `SELECT o.*, sc.label_ru, sc.emoji, COALESCE(sc.is_final, 0) AS is_final
       FROM orders o
       LEFT JOIN status_catalog sc ON sc.code = o.current_status_code
       WHERE o.telegram_id = ?
       ORDER BY o.updated_at DESC`
    )
    .all(telegramId);
}

function createOrder({ orderNumber, cargoDescription, route, etaDate, boundUsername, initialStatusCode }) {
  const now = nowIso();
  const resolvedClient = boundUsername ? findClientByUsername(boundUsername) : undefined;
  db.prepare(
    `INSERT INTO orders
       (order_number, cargo_description, route, eta_date, current_status_code,
        current_comment, telegram_id, bound_username, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`
  ).run(
    orderNumber,
    cargoDescription || null,
    route || null,
    etaDate || null,
    initialStatusCode || null,
    resolvedClient ? resolvedClient.telegram_id : null,
    boundUsername ? normalizeUsername(boundUsername) : null,
    now,
    now
  );
}

function updateOrderMasterData({ orderNumber, cargoDescription, route, etaDate, boundUsername }) {
  const resolvedClient = boundUsername ? findClientByUsername(boundUsername) : undefined;
  db.prepare(
    `UPDATE orders SET
       cargo_description = ?,
       route = ?,
       eta_date = ?,
       bound_username = ?,
       telegram_id = COALESCE(?, telegram_id),
       updated_at = ?
     WHERE order_number = ?`
  ).run(
    cargoDescription || null,
    route || null,
    etaDate || null,
    boundUsername ? normalizeUsername(boundUsername) : null,
    resolvedClient ? resolvedClient.telegram_id : null,
    nowIso(),
    orderNumber
  );
}

function updateOrderStatus({ orderNumber, statusCode, comment }) {
  db.prepare(
    `UPDATE orders SET current_status_code = ?, current_comment = ?, updated_at = ?
     WHERE order_number = ?`
  ).run(statusCode, comment || null, nowIso(), orderNumber);
}

function appendStatusHistory({ orderNumber, statusCode, comment, source }) {
  db.prepare(
    `INSERT INTO status_history (order_number, status_code, comment, changed_at, source)
     VALUES (?, ?, ?, ?, ?)`
  ).run(orderNumber, statusCode, comment || null, nowIso(), source);
}

function getOrderHistory(orderNumber) {
  return db
    .prepare(
      `SELECT h.*, sc.label_ru, sc.emoji
       FROM status_history h
       JOIN status_catalog sc ON sc.code = h.status_code
       WHERE h.order_number = ?
       ORDER BY h.changed_at ASC`
    )
    .all(orderNumber);
}

function listActiveOrdersGroupedByClient() {
  return db
    .prepare(
      `SELECT o.telegram_id, o.order_number, o.cargo_description, o.route,
              o.eta_date, sc.label_ru, sc.emoji
       FROM orders o
       JOIN status_catalog sc ON sc.code = o.current_status_code
       WHERE sc.is_final = 0 AND o.telegram_id IS NOT NULL
       ORDER BY o.telegram_id, o.order_number`
    )
    .all();
}

// --- sync bookkeeping ---

function syncLogExists(orderNumber, statusCode, comment) {
  const hash = contentHash(statusCode, comment);
  return !!db
    .prepare('SELECT 1 FROM sync_log WHERE order_number = ? AND content_hash = ?')
    .get(orderNumber, hash);
}

function recordSyncLog(orderNumber, statusCode, comment, result) {
  const hash = contentHash(statusCode, comment);
  db.prepare(
    `INSERT OR IGNORE INTO sync_log (order_number, content_hash, processed_at, result)
     VALUES (?, ?, ?, ?)`
  ).run(orderNumber, hash, nowIso(), result);
}

// --- manager actions ---

function logManagerAction({ managerTelegramId, orderNumber, newStatusCode, comment }) {
  db.prepare(
    `INSERT INTO manager_actions_log
       (manager_telegram_id, order_number, new_status_code, comment, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(managerTelegramId, orderNumber, newStatusCode, comment || null, nowIso());
}

module.exports = {
  withTransaction,
  normalizeUsername,
  upsertClient,
  findClientByUsername,
  listStatusCatalog,
  getStatus,
  isValidStatusCode,
  findOrder,
  listOrdersForClient,
  createOrder,
  updateOrderMasterData,
  updateOrderStatus,
  appendStatusHistory,
  getOrderHistory,
  listActiveOrdersGroupedByClient,
  syncLogExists,
  recordSyncLog,
  logManagerAction,
};
