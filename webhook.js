// Webhook server that listens for Google Sheets updates via Apps Script.
// Both endpoints accept a batch of rows so a multi-row paste/delete in the
// sheet (which fires one onEdit event covering several rows) is applied
// atomically and instantly, not just single-cell edits.

const crypto = require('node:crypto');
const express = require('express');
const config = require('./config');
const queries = require('./db/queries');
const logger = require('./lib/logger');

const app = express();
app.use(express.json({ charset: 'utf-8' }));
app.use((req, res, next) => {
  req.setEncoding('utf8');
  next();
});

// These endpoints are reachable from the public internet via the ngrok
// tunnel and let a caller rewrite order status/master data that clients see
// verbatim in Telegram — without this check, anyone who has (or guesses,
// since cargo IDs are sequential) the ngrok URL could inject fake status
// messages impersonating the company. Google Apps Script sends the same
// secret in the X-Webhook-Secret header (see deploy/google-apps-script.gs).
function requireWebhookSecret(req, res, next) {
  const provided = req.get('X-Webhook-Secret') || '';
  const expected = config.webhookSecret;
  const ok =
    provided.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  if (!ok) {
    logger.warn('webhook: rejected request with invalid/missing secret', req.path, req.ip);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
app.use('/webhook', requireWebhookSecret);

// POST /webhook/tracking-sync
// The "Трекинг" sheet is the source of truth for status text. On any edit
// (including clearing a cell), Apps Script re-sends the FULL row's non-empty
// (Status N, Date N) pairs for every edited row, in order. We reconcile our
// copy of the sheet-driven history to match exactly — handles edits,
// reordering, and deletions, not just appends.
// Expected body: { rows: [ { cargoId, statuses: [{text, date}, ...] }, ... ] }
app.post('/webhook/tracking-sync', async (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows)) {
    return res.status(400).json({ error: 'Missing rows array' });
  }

  const results = [];
  for (const { cargoId, statuses } of rows) {
    if (!cargoId || !Array.isArray(statuses)) {
      results.push({ cargoId, ok: false, error: 'Missing cargoId or statuses' });
      continue;
    }
    try {
      const order = queries.findOrder(cargoId);
      if (!order) {
        logger.warn('webhook: cargo not found', cargoId);
        results.push({ cargoId, ok: false, error: 'not found' });
        continue;
      }
      queries.withTransaction(() => {
        queries.replaceSheetStatusHistory(cargoId, statuses);
      });
      const currentStatus = statuses.length > 0 ? statuses[statuses.length - 1].text : null;
      logger.info('webhook: statuses synced', cargoId, `${statuses.length} entries`, 'current:', currentStatus);
      results.push({ cargoId, ok: true, currentStatus });
    } catch (err) {
      logger.error('webhook: tracking-sync error', cargoId, err.message);
      results.push({ cargoId, ok: false, error: 'internal error' });
    }
  }

  return res.json({ ok: true, results });
});

// POST /webhook/order-sync
// The "Заявки" sheet is the source of truth for master data. Create-or-update
// per row, including re-resolving the client's telegram_id from their
// username on every edit.
// Expected body: { rows: [ { cargoId, client, cargo, route, eta, stage }, ... ] }
// stage is one of AT_FACTORY | IN_TRANSIT | DELIVERED (see queries.STAGES);
// anything else is ignored and the order's existing stage is left as-is.
app.post('/webhook/order-sync', async (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows)) {
    return res.status(400).json({ error: 'Missing rows array' });
  }

  const results = [];
  for (const row of rows) {
    const cargoId = row.cargoId;
    if (!cargoId) {
      results.push({ cargoId, ok: false, error: 'Missing cargoId' });
      continue;
    }
    try {
      const outcome = queries.upsertOrderMasterData({
        orderNumber: cargoId,
        cargoDescription: row.cargo || null,
        route: row.route || null,
        etaDate: row.eta || null,
        boundUsername: row.client || null,
        stage: row.stage || null,
      });
      logger.info('webhook: order synced', cargoId, outcome.created ? 'created' : 'updated');
      results.push({ cargoId, ok: true, created: outcome.created });
    } catch (err) {
      logger.error('webhook: order-sync error', cargoId, err.message);
      results.push({ cargoId, ok: false, error: err.message });
    }
  }

  return res.json({ ok: true, results });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'china-cargo-webhook' });
});

function startWebhookServer(port = 3000) {
  app.listen(port, () => {
    logger.info(`Webhook server listening on port ${port}`);
  });
}

module.exports = { startWebhookServer };
