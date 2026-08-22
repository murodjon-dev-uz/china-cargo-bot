// Webhook server that listens for Google Sheets updates via Apps Script.
// When a status is updated in the Трекинг sheet, this immediately updates the DB.

const express = require('express');
const config = require('./config');
const queries = require('./db/queries');
const logger = require('./lib/logger');
const { inferStatusCode } = require('./lib/statusInference');

const app = express();
app.use(express.json());

// Webhook endpoint: POST /webhook/tracking-update
// Expected body:
// {
//   cargoId: "CL-001",
//   statusText: "Груз на границе, ожидает таможни",
//   date: "2026-08-25"
// }
app.post('/webhook/tracking-update', async (req, res) => {
  const { cargoId, statusText, date } = req.body;

  if (!cargoId || !statusText) {
    return res.status(400).json({ error: 'Missing cargoId or statusText' });
  }

  try {
    const order = queries.findOrder(cargoId);
    if (!order) {
      logger.warn('webhook: cargo not found', cargoId);
      return res.status(404).json({ error: `Cargo ${cargoId} not found` });
    }

    const statusCode = inferStatusCode(statusText);

    // Update DB immediately (real-time)
    queries.withTransaction(() => {
      queries.updateOrderStatus({
        orderNumber: cargoId,
        statusCode: statusCode || null,
        comment: statusText
      });
      if (statusCode) {
        queries.appendStatusHistory({
          orderNumber: cargoId,
          statusCode,
          comment: statusText,
          source: 'sheet_webhook',
        });
        queries.recordSyncLog(cargoId, statusCode, statusText, 'applied');
      }
    });

    logger.info('webhook: status updated', cargoId, statusCode || 'unknown');
    return res.json({
      ok: true,
      message: `Status updated for ${cargoId}`,
      statusCode: statusCode || null
    });
  } catch (err) {
    logger.error('webhook: error', err.message);
    return res.status(500).json({ error: err.message });
  }
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
