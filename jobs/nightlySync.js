const config = require('../config');
const sheets = require('../sheets');
const queries = require('../db/queries');
const logger = require('../lib/logger');
const { formatDateTimeRu } = require('../lib/format');

/**
 * Runs one full sync pass: ingests order master data, then status updates.
 * `telegram` is a telegraf Telegram instance used to notify clients/managers
 * (passed in so this module has no hard dependency on the live bot process —
 * it can also be run standalone via `npm run sync` for testing).
 */
async function runNightlySync(telegram) {
  logger.info('nightlySync: start');
  const problems = [];

  // --- Step 1: order master data (Заявки tab) ---
  const orderRows = await sheets.readTab(config.sheets.ordersTab);
  for (const row of orderRows) {
    const orderNumber = row['Номер заявки'];
    if (!orderNumber) continue;

    const existing = queries.findOrder(orderNumber);
    const cargoDescription = row['Описание груза'];
    const route = row['Маршрут'];
    const etaDate = row['ETA'];
    const boundUsername = row['Клиент'];

    if (!existing) {
      const initialStatusCode = row['Текущий статус (при создании)'];
      if (initialStatusCode && !queries.isValidStatusCode(initialStatusCode)) {
        problems.push(`«Заявки», строка ${row._row}: неизвестный начальный статус "${initialStatusCode}" для ${orderNumber}`);
      }
      queries.withTransaction(() => {
        queries.createOrder({
          orderNumber,
          cargoDescription,
          route,
          etaDate,
          boundUsername,
          initialStatusCode: queries.isValidStatusCode(initialStatusCode) ? initialStatusCode : null,
        });
        if (queries.isValidStatusCode(initialStatusCode)) {
          queries.appendStatusHistory({
            orderNumber,
            statusCode: initialStatusCode,
            comment: null,
            source: 'initial',
          });
        }
      });
      logger.info('nightlySync: created order', orderNumber);
    } else {
      // Existing order — master data fields only, status column is intentionally ignored
      // (all status changes after creation flow through the "Статусы для бота" tab).
      queries.updateOrderMasterData({ orderNumber, cargoDescription, route, etaDate, boundUsername });
    }
  }

  // --- Step 2: status updates (Статусы для бота tab) ---
  const statusRows = await sheets.readTab(config.sheets.statusesTab);
  let applied = 0;
  let skipped = 0;

  for (const row of statusRows) {
    const orderNumber = row['Номер заявки'];
    const statusCode = row['Новый статус'];
    const comment = row['Комментарий'] || '';
    if (!orderNumber || !statusCode) continue;

    const order = queries.findOrder(orderNumber);
    if (!order) {
      problems.push(`«Статусы для бота», строка ${row._row}: неизвестный номер заявки "${orderNumber}"`);
      queries.recordSyncLog(orderNumber, statusCode, comment, 'skipped_unknown_order');
      skipped++;
      continue;
    }
    if (!queries.isValidStatusCode(statusCode)) {
      problems.push(`«Статусы для бота», строка ${row._row}: неизвестный статус "${statusCode}" для заявки ${orderNumber}`);
      queries.recordSyncLog(orderNumber, statusCode, comment, 'skipped_invalid_status');
      skipped++;
      continue;
    }
    if (queries.syncLogExists(orderNumber, statusCode, comment)) {
      continue; // already processed this exact status+comment before
    }

    queries.withTransaction(() => {
      queries.updateOrderStatus({ orderNumber, statusCode, comment });
      queries.appendStatusHistory({ orderNumber, statusCode, comment, source: 'sheet_sync' });
      queries.recordSyncLog(orderNumber, statusCode, comment, 'applied');
    });
    applied++;

    const refreshedOrder = queries.findOrder(orderNumber);
    const status = queries.getStatus(statusCode);
    if (refreshedOrder.telegram_id && telegram) {
      try {
        await telegram.sendMessage(
          refreshedOrder.telegram_id,
          `У вашей заявки ${orderNumber} новый статус: ${status.label_ru} ${status.emoji || ''}.` +
            (comment ? ` Комментарий: ${comment}` : '')
        );
      } catch (err) {
        logger.warn('nightlySync: notify failed', refreshedOrder.telegram_id, err.message);
      }
    } else if (!refreshedOrder.telegram_id) {
      logger.warn('nightlySync: status applied but order has no resolved client binding yet', orderNumber);
    }

    if (telegram) {
      await sheets.writeCell(config.sheets.statusesTab, row._row, 'D', `✅ ${formatDateTimeRu(new Date().toISOString())}`);
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
