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

function contentHash(statusText, comment) {
  return crypto
    .createHash('sha256')
    .update(`${statusText}|${comment || ''}`)
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

// --- orders ---

// Classification the bot uses for its own logic (digest filtering, order-list
// badges) — separate from the free-text status the client reads. Exactly
// three fixed values, set by the manager via a dropdown in the "Заявки" tab.
const STAGES = {
  AT_FACTORY: { emoji: '🏭', label: 'На заводе' },
  IN_TRANSIT: { emoji: '🚚', label: 'В пути' },
  DELIVERED: { emoji: '✅', label: 'Доставлен' },
};
const DEFAULT_STAGE = 'AT_FACTORY';

function getStageInfo(stage) {
  return STAGES[stage] || STAGES[DEFAULT_STAGE];
}

// Accepts either a raw code ("AT_FACTORY") or the exact dropdown cell text
// ("🏭 На заводе") that Apps Script sends verbatim — resolves either to a
// valid code, or null if unrecognized (caller keeps the existing stage then).
const STAGE_BY_CELL_TEXT = Object.fromEntries(
  Object.entries(STAGES).map(([code, { emoji, label }]) => [`${emoji} ${label}`, code])
);

function normalizeStage(stage) {
  if (!stage) return null;
  if (STAGES[stage]) return stage;
  return STAGE_BY_CELL_TEXT[stage.trim()] || null;
}

function createOrder({
  orderNumber,
  cargoDescription,
  route,
  etaDate,
  currentStatus,
  boundUsername,
  telegramId,
  stage
}) {
  const now = nowIso();
  db.prepare(
    `INSERT INTO orders (order_number, cargo_description, route, eta_date, current_status, telegram_id, bound_username, stage, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(orderNumber, cargoDescription || null, route || null, etaDate || null, currentStatus || null, telegramId || null, boundUsername || null, normalizeStage(stage) || DEFAULT_STAGE, now, now);
}

function findOrder(orderNumber) {
  return db.prepare('SELECT * FROM orders WHERE order_number = ?').get(orderNumber);
}

function updateOrder({ orderNumber, cargoDescription, route, etaDate, boundUsername }) {
  const now = nowIso();
  db.prepare(
    `UPDATE orders SET cargo_description = ?, route = ?, eta_date = ?, bound_username = ?, updated_at = ?
     WHERE order_number = ?`
  ).run(cargoDescription, route, etaDate, boundUsername, now, orderNumber);
}

// Real-time master-data sync from the "Заявки" tab (create-or-update).
// Re-resolves telegram_id from bound_username on every call, so a client
// who /start's the bot after their order was created gets bound on the very
// next edit to their row (or self-heals automatically — see resolveClientBindings).
function upsertOrderMasterData({ orderNumber, cargoDescription, route, etaDate, boundUsername, stage }) {
  const existing = findOrder(orderNumber);
  const client = findClientByUsername(boundUsername);
  const telegramId = client ? client.telegram_id : (existing ? existing.telegram_id : null);

  if (!existing) {
    createOrder({ orderNumber, cargoDescription, route, etaDate, boundUsername, telegramId, stage });
    return { created: true };
  }

  // An empty/unrecognized stage from the sheet leaves the existing stage
  // untouched, rather than silently resetting it to the default.
  const nextStage = normalizeStage(stage) || existing.stage;

  const now = nowIso();
  db.prepare(
    `UPDATE orders SET cargo_description = ?, route = ?, eta_date = ?, bound_username = ?, telegram_id = ?, stage = ?, updated_at = ?
     WHERE order_number = ?`
  ).run(cargoDescription, route, etaDate, boundUsername, telegramId, nextStage, now, orderNumber);
  return { created: false };
}

// Re-resolves telegram_id for every order with an unbound or stale
// bound_username against the clients table. Called after a client presses
// /start, so any order pre-assigned to their username self-heals immediately.
function resolveClientBindings() {
  const orders = db.prepare('SELECT order_number, bound_username, telegram_id FROM orders WHERE bound_username IS NOT NULL').all();
  let bound = 0;
  for (const o of orders) {
    const client = findClientByUsername(o.bound_username);
    if (client && client.telegram_id !== o.telegram_id) {
      db.prepare('UPDATE orders SET telegram_id = ?, updated_at = ? WHERE order_number = ?')
        .run(client.telegram_id, nowIso(), o.order_number);
      bound++;
    }
  }
  return bound;
}

function updateOrderStatus({ orderNumber, statusText, comment }) {
  const now = nowIso();
  db.prepare(
    `UPDATE orders SET current_status = ?, current_comment = ?, updated_at = ?
     WHERE order_number = ?`
  ).run(statusText, comment || null, now, orderNumber);
}

function listOrdersForClient(telegramId) {
  return db.prepare('SELECT * FROM orders WHERE telegram_id = ? ORDER BY created_at DESC').all(telegramId);
}

// Used by the morning digest — excludes DELIVERED orders so clients stop
// getting daily pings about shipments they already received.
function listActiveOrdersWithClients() {
  return db
    .prepare("SELECT * FROM orders WHERE telegram_id IS NOT NULL AND stage != 'DELIVERED' ORDER BY telegram_id")
    .all();
}

// Owner/manager overview — every order, across every client, grouped for
// display. Orders whose client hasn't /start'd the bot yet (no telegram_id)
// are grouped by their raw bound_username instead, so nothing is silently
// dropped from the overview.
function listAllOrdersForOverview() {
  return db
    .prepare(
      `SELECT * FROM orders
       ORDER BY COALESCE(bound_username, ''), telegram_id IS NULL, telegram_id, created_at`
    )
    .all();
}

// --- status history ---

function appendStatusHistory({ orderNumber, statusText, comment, source }) {
  const now = nowIso();
  db.prepare(
    `INSERT INTO status_history (order_number, status_text, comment, changed_at, source)
     VALUES (?, ?, ?, ?, ?)`
  ).run(orderNumber, statusText, comment || null, now, source || 'manual');
}

function getOrderHistory(orderNumber) {
  return db
    .prepare(
      `SELECT h.*,
              ROW_NUMBER() OVER (PARTITION BY h.status_text ORDER BY h.changed_at DESC) as rn
       FROM status_history h
       WHERE h.order_number = ?`
    )
    .all(orderNumber)
    .filter(h => h.rn === 1)
    .sort((a, b) => new Date(a.changed_at) - new Date(b.changed_at));
}

// Reconciles the sheet-driven portion of an order's history to exactly match
// the given ordered list of {text, date}. The sheet is the source of truth
// for this slice: existing 'sheet_webhook' rows are dropped and replaced,
// so edits/reordering/deletion in the sheet are reflected correctly (not
// just appends). Manager/OpenClaw-sourced history rows are untouched.
function replaceSheetStatusHistory(orderNumber, statuses) {
  db.prepare(`DELETE FROM status_history WHERE order_number = ? AND source = 'sheet_webhook'`).run(orderNumber);

  let lastText = null;
  statuses.forEach((s, i) => {
    if (!s.text) return;
    // Preserve row order even when multiple entries share a date: offset by
    // index so ORDER BY changed_at keeps them in the sheet's left-to-right order.
    const changedAt = s.date
      ? new Date(new Date(s.date).getTime() + i * 1000).toISOString()
      : new Date(Date.now() + i * 1000).toISOString();
    db.prepare(
      `INSERT INTO status_history (order_number, status_text, comment, changed_at, source)
       VALUES (?, ?, NULL, ?, 'sheet_webhook')`
    ).run(orderNumber, s.text, changedAt);
    lastText = s.text;
  });

  const now = nowIso();
  db.prepare(`UPDATE orders SET current_status = ?, updated_at = ? WHERE order_number = ?`)
    .run(lastText, now, orderNumber);
}

// --- sync log ---

function recordSyncLog(orderNumber, statusText, comment, result) {
  const hash = contentHash(statusText, comment);
  const now = nowIso();
  db.prepare(
    `INSERT OR IGNORE INTO sync_log (order_number, content_hash, processed_at, result)
     VALUES (?, ?, ?, ?)`
  ).run(orderNumber, hash, now, result);
}

function hasSyncedBefore(orderNumber, statusText, comment) {
  const hash = contentHash(statusText, comment);
  const row = db
    .prepare('SELECT 1 FROM sync_log WHERE order_number = ? AND content_hash = ?')
    .get(orderNumber, hash);
  return !!row;
}

// --- manager actions ---

function recordManagerAction({ managerTelegramId, orderNumber, statusText, comment }) {
  const now = nowIso();
  db.prepare(
    `INSERT INTO manager_actions_log (manager_telegram_id, order_number, new_status_text, comment, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(managerTelegramId, orderNumber, statusText || null, comment || null, now);
}

// --- exports ---

module.exports = {
  withTransaction,
  contentHash,
  upsertClient,
  findClientByUsername,
  normalizeUsername,
  createOrder,
  findOrder,
  updateOrder,
  upsertOrderMasterData,
  resolveClientBindings,
  updateOrderStatus,
  listOrdersForClient,
  listActiveOrdersWithClients,
  listAllOrdersForOverview,
  STAGES,
  getStageInfo,
  appendStatusHistory,
  getOrderHistory,
  replaceSheetStatusHistory,
  recordSyncLog,
  hasSyncedBefore,
  recordManagerAction,
};
