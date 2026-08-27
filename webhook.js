// Webhook server that listens for Google Sheets updates via Apps Script.
// Both endpoints accept a batch of rows so a multi-row paste/delete in the
// sheet (which fires one onEdit event covering several rows) is applied
// atomically and instantly, not just single-cell edits.

const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const { z } = require('zod');
const config = require('./config');
const queries = require('./db/queries');
const database = require('./db/db');
const logger = require('./lib/logger');

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ charset: 'utf-8', limit: '128kb' }));
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
const limiter = new RateLimiterMemory({ points: 120, duration: 60 });
app.use('/webhook', async (req, res, next) => {
  try { await limiter.consume(req.ip); next(); }
  catch { res.status(429).json({ error: 'Too many requests' }); }
});

const trackingSchema = z.object({ rows: z.array(z.object({
  cargoId: z.string().trim().min(1).max(128),
  statuses: z.array(z.object({ text: z.string().trim().min(1).max(2000), date: z.string().max(64).optional().nullable() })).max(100),
})).min(1).max(100) });
const orderSchema = z.object({ rows: z.array(z.object({
  cargoId: z.string().trim().min(1).max(128), client: z.string().max(256).optional().nullable(),
  phone: z.string().max(64).optional().nullable(),
  cargo: z.string().max(2000).optional().nullable(), route: z.string().max(1000).optional().nullable(),
  eta: z.string().max(64).optional().nullable(), stage: z.string().max(64).optional().nullable(),
})).min(1).max(100) });

// POST /webhook/tracking-sync
// The "Трекинг" sheet is the source of truth for status text. On any edit
// (including clearing a cell), Apps Script re-sends the FULL row's non-empty
// (Status N, Date N) pairs for every edited row, in order. We reconcile our
// copy of the sheet-driven history to match exactly — handles edits,
// reordering, and deletions, not just appends.
// Expected body: { rows: [ { cargoId, statuses: [{text, date}, ...] }, ... ] }
app.post('/webhook/tracking-sync', async (req, res) => {
  const parsed = trackingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });
  const { rows } = parsed.data;

  const results = [];
  for (const { cargoId, statuses } of rows) {
    if (!cargoId || !Array.isArray(statuses)) {
      results.push({ cargoId, ok: false, error: 'Missing cargoId or statuses' });
      continue;
    }
    try {
      const order = await queries.findOrder(cargoId);
      if (!order) {
        logger.warn('webhook: cargo not found', cargoId);
        results.push({ cargoId, ok: false, error: 'not found' });
        continue;
      }
      await queries.withTransaction(async (client) => {
        await queries.replaceSheetStatusHistory(cargoId, statuses, client);
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
// confirmed phone number on every edit.
// Expected body: { rows: [ { cargoId, client, cargo, route, eta, stage }, ... ] }
// stage is one of AT_FACTORY | IN_TRANSIT | DELIVERED (see queries.STAGES);
// anything else is ignored and the order's existing stage is left as-is.
app.post('/webhook/order-sync', async (req, res) => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });
  const { rows } = parsed.data;

  const results = [];
  for (const row of rows) {
    const cargoId = row.cargoId;
    if (!cargoId) {
      results.push({ cargoId, ok: false, error: 'Missing cargoId' });
      continue;
    }
    try {
      const outcome = await queries.withTransaction((client) => queries.upsertOrderMasterData({
        orderNumber: cargoId,
        cargoDescription: row.cargo || null,
        route: row.route || null,
        etaDate: row.eta || null,
        clientName: row.client || null,
        boundPhone: row.phone || null,
        stage: row.stage || null,
      }, client));
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
app.get('/health', async (req, res) => {
  try { await database.ping(); res.json({ ok: true, service: 'china-cargo-webhook' }); }
  catch { res.status(503).json({ ok: false, service: 'china-cargo-webhook' }); }
});

function startWebhookServer(port = config.port) {
  return app.listen(port, () => {
    logger.info(`Webhook server listening on port ${port}`);
  });
}

module.exports = { startWebhookServer };
