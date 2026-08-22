const config = require('../config');
const sheets = require('../sheets');
const queries = require('../db/queries');
const logger = require('../lib/logger');
const { inferStatusCode } = require('../lib/statusInference');

/**
 * Runs one full sync pass: ingests order master data, then status updates.
 * `telegram` is a telegraf Telegram instance used to notify clients/managers
 * (passed in so this module has no hard dependency on the live bot process —
 * it can also be run standalone via `npm run sync` for testing).
 *
 * Statuses are written by the manager as free-form client-facing text
 * («Сообщение клиенту» column). The canonical status code is derived from
 * the text via the synonym dictionary; rows that can't be mapped confidently
 * are reported to managers and skipped (client text is not sent blindly).
 */
async function runNightlySync(telegram) {
  logger.info('nightlySync: start');
  const problems = [];

  // --- Step 1: order master data (Заявки tab) ---
  const orderRows = await sheets.readTab(config.sheets.ordersTab);
  for (const row of orderRows) {
    const orderNumber = row[config.sheets.orderNumberCol];
    if (!orderNumber) continue;

    const existing = queries.findOrder(orderNumber);
    const cargoDescription = row[config.sheets.cargoCol];
    const route = row[config.sheets.routeCol];
    const etaDate = row[config.sheets.etaCol];
    const boundUsername = row[config.sheets.clientCol];

    if (!existing) {
      // No initial status anymore: a new order starts without a status and
      // gets its first one from the «Статусы для бота» tab.
      queries.createOrder({ orderNumber, cargoDescription, route, etaDate, boundUsername });
      logger.info('nightlySync: created order', orderNumber);
    } else {
      // Existing order — master data fields only.
      queries.updateOrderMasterData({ orderNumber, cargoDescription, route, etaDate, boundUsername });
    }
  }

  // --- Step 2: status updates (Статусы для бота tab) ---
  const statusRows = await sheets.readTab(config.sheets.statusesTab);
  let applied = 0;
  let skipped = 0;

  for (const row of statusRows) {
    const orderNumber = row[config.sheets.orderNumberCol];
    const message = row[config.sheets.statusMessageCol] || '';
    if (!orderNumber || !message) continue;

    const statusCode = inferStatusCode(message);
    const order = queries.findOrder(orderNumber);
    if (!order) {
      problems.push(`«Статусы для бота», строка ${row._row}: неизвестный номер заявки "${orderNumber}"`);
      queries.recordSyncLog(orderNumber, statusCode || '', message, 'skipped_unknown_order');
      skipped++;
      continue;
    }
    if (!statusCode || !queries.isValidStatusCode(statusCode)) {
      problems.push(
        `«Статусы для бота», строка ${row._row}: не удалось распознать статус в сообщении «${message}» для заявки ${orderNumber}`
      );
      queries.recordSyncLog(orderNumber, statusCode || '', message, 'skipped_unrecognized_status');
      skipped++;
      continue;
    }
    if (queries.syncLogExists(orderNumber, statusCode, message)) {
      continue; // already processed this exact status+message before
    }

    queries.withTransaction(() => {
      queries.updateOrderStatus({ orderNumber, statusCode, comment: message });
      queries.appendStatusHistory({ orderNumber, statusCode, comment: message, source: 'sheet_sync' });
      queries.recordSyncLog(orderNumber, statusCode, message, 'applied');
    });
    applied++;

    if (order.telegram_id && telegram) {
      try {
        await telegram.sendMessage(order.telegram_id, `По заявке ${orderNumber}:\n${message}`);
      } catch (err) {
        logger.warn('nightlySync: notify failed', order.telegram_id, err.message);
      }
    } else if (!order.telegram_id) {
      logger.warn('nightlySync: status applied but order has no resolved client binding yet', orderNumber);
    }
  }

  // --- Step 3: report problems to managers ---
  if (problems.length > 0 && telegram) {
    const text = `Ночная синхронизация: обнаружены проблемы:\n${problems.join('\n')}`;
    for (const managerId of config.managerTelegramIds) {
      try {
        await telegram.sendMessage(managerId, text);
      } catch (err) {
        logger.error('nightlySync: failed to notify manager', managerId, err.message);
      }
    }
  }

  logger.info('nightlySync: done', { applied, skipped, problems: problems.length });
  return { applied, skipped, problems };
}

module.exports = { runNightlySync };

if (require.main === module) {
  // Standalone run for testing: `npm run sync`. Uses a bare Telegram client
  // (no polling) so client/manager notifications still work.
  const { Telegram } = require('telegraf');
  const telegram = new Telegram(config.botToken);
  runNightlySync(telegram)
    .then((result) => {
      console.log('Sync result:', result);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
