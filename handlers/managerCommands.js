const config = require('../config');
const queries = require('../db/queries');
const { statusPicker } = require('../keyboards');
const logger = require('../lib/logger');

// In-memory, process-local — fine to lose on restart, it's just "awaiting a comment" state
// for the rare manual/emergency status-change flow.
const pendingComment = new Map(); // managerTelegramId -> { orderNumber, statusCode }

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
    return ctx.reply(`Новый статус для ${orderNumber}:`, statusPicker(queries.listStatusCatalog(), orderNumber));
  });

  bot.action(/^setstatus:(.+):(.+)$/, async (ctx) => {
    if (!isManager(ctx.from.id)) return ctx.answerCbQuery();

    const [, orderNumber, statusCode] = ctx.match;
    if (!queries.isValidStatusCode(statusCode)) {
      return ctx.answerCbQuery('Неверный статус', { show_alert: true });
    }
    pendingComment.set(ctx.from.id, { orderNumber, statusCode });
    await ctx.answerCbQuery();
    return ctx.reply('Комментарий для клиента? Напишите текст или отправьте /skip, чтобы оставить пустым.');
  });

  bot.command('skip', async (ctx) => {
    if (!isManager(ctx.from.id)) return;
    const pending = pendingComment.get(ctx.from.id);
    if (!pending) return;
    pendingComment.delete(ctx.from.id);
    await applyManualStatus(ctx, pending.orderNumber, pending.statusCode, null);
  });

  // Plain-text comment reply — the one narrow, manager-only exception to
  // "no free text" (comments are inherently open text, see plan §8).
  bot.on('text', async (ctx, next) => {
    if (!isManager(ctx.from.id)) return next();
    const pending = pendingComment.get(ctx.from.id);
    if (!pending) return next();
    pendingComment.delete(ctx.from.id);
    await applyManualStatus(ctx, pending.orderNumber, pending.statusCode, ctx.message.text);
  });
}

async function applyManualStatus(ctx, orderNumber, statusCode, comment) {
  queries.withTransaction(() => {
    queries.updateOrderStatus({ orderNumber, statusCode, comment });
    queries.appendStatusHistory({ orderNumber, statusCode, comment, source: 'manual_manager_command' });
    queries.logManagerAction({
      managerTelegramId: ctx.from.id,
      orderNumber,
      newStatusCode: statusCode,
      comment,
    });
  });

  const order = queries.findOrder(orderNumber);
  const status = queries.getStatus(statusCode);
  if (order.telegram_id) {
    try {
      await ctx.telegram.sendMessage(
        order.telegram_id,
        `У вашей заявки ${orderNumber} новый статус: ${status.label_ru} ${status.emoji || ''}.` +
          (comment ? ` Комментарий: ${comment}` : '')
      );
    } catch (err) {
      logger.error('Manual status: failed to notify client', order.telegram_id, err.message);
    }
  }

  return ctx.reply(`Готово: ${orderNumber} → ${status.label_ru}`);
}

module.exports = { registerManagerCommands, isManager };
