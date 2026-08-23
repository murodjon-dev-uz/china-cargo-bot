const config = require('../config');
const queries = require('../db/queries');
const logger = require('../lib/logger');

// In-memory, process-local — fine to lose on restart, it's just "awaiting a status text" state
// for the rare manual/emergency status-change flow.
const pendingStatus = new Map(); // managerTelegramId -> orderNumber

function isManager(telegramId) {
  return config.managerTelegramIds.includes(telegramId);
}

function registerManagerCommands(bot) {
  bot.command('status', (ctx) => {
    if (!isManager(ctx.from.id)) return; // silently ignore non-managers

    const orderNumber = ctx.message.text.split(/\s+/)[1];
    if (!orderNumber) {
      return ctx.reply('Использование: /status CL-001');
    }
    const order = queries.findOrder(orderNumber);
    if (!order) {
      return ctx.reply(`Заявка ${orderNumber} не найдена.`);
    }
    pendingStatus.set(ctx.from.id, orderNumber);
    return ctx.reply(`Напишите текст нового статуса для ${orderNumber} (то, что увидит клиент):`);
  });

  // Plain-text status reply — this is a manager-only exception to
  // "no free text" (see plan §8); the text becomes exactly what the client sees.
  bot.on('text', async (ctx, next) => {
    if (!isManager(ctx.from.id)) return next();
    const orderNumber = pendingStatus.get(ctx.from.id);
    if (!orderNumber) return next();
    pendingStatus.delete(ctx.from.id);
    await applyManualStatus(ctx, orderNumber, ctx.message.text);
  });
}

async function applyManualStatus(ctx, orderNumber, statusText) {
  queries.withTransaction(() => {
    queries.updateOrderStatus({ orderNumber, statusText, comment: null });
    queries.appendStatusHistory({ orderNumber, statusText, comment: null, source: 'manual_manager_command' });
    queries.recordManagerAction({
      managerTelegramId: ctx.from.id,
      orderNumber,
      statusText,
      comment: null,
    });
  });

  const order = queries.findOrder(orderNumber);
  if (order.telegram_id) {
    try {
      await ctx.telegram.sendMessage(order.telegram_id, `У вашей заявки ${orderNumber} новый статус: ${statusText}`);
    } catch (err) {
      logger.error('Manual status: failed to notify client', order.telegram_id, err.message);
    }
  }

  return ctx.reply(`Готово: ${orderNumber} → ${statusText}`);
}

module.exports = { registerManagerCommands, isManager };
