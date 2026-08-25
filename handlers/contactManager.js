const config = require('../config');
const queries = require('../db/queries');
const { CONTACT_MANAGER_BUTTON } = require('../keyboards');
const { escapeHtml } = require('../lib/format');
const logger = require('../lib/logger');

// Confirms in past tense (it's done), then sets the expectation the client
// would otherwise have to ask about: who replies, and where.
const CLIENT_CONFIRMATION = [
  '✅ <b>Передали менеджеру</b>',
  '',
  'Он свяжется с вами в ближайшее время — ответ придёт сюда, в этот чат.',
].join('\n');

function registerContactManager(bot) {
  bot.hears(CONTACT_MANAGER_BUTTON, async (ctx) => {
    await ctx.reply(CLIENT_CONFIRMATION, { parse_mode: 'HTML' });

    const who = ctx.from.username ? `@${escapeHtml(ctx.from.username)}` : escapeHtml(ctx.from.first_name || 'Клиент');
    const orders = queries.listOrdersForClient(ctx.from.id);
    const active = orders.filter((o) => o.stage !== 'DELIVERED');

    const lines = [
      '🔔 <b>Клиент просит связаться</b>',
      '',
      `${who} · ID <code>${ctx.from.id}</code>`,
    ];
    if (active.length > 0) {
      lines.push('', 'Активные заявки:');
      lines.push(...active.map((o) => `   <code>${escapeHtml(o.order_number)}</code>`));
    } else if (orders.length > 0) {
      lines.push('', '<i>Активных заявок нет</i>');
    } else {
      lines.push('', '<i>Заявок в системе нет</i>');
    }

    try {
      await ctx.telegram.sendMessage(config.managerGroupChatId, lines.join('\n'), {
        parse_mode: 'HTML',
        ...(config.managerGroupTopicId ? { message_thread_id: config.managerGroupTopicId } : {}),
      });
    } catch (err) {
      logger.error('Failed to notify manager group', err.message);
    }
  });
}

module.exports = { registerContactManager };
