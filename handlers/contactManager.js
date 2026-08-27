const config = require('../config');
const queries = require('../db/queries');
const { CONTACT_MANAGER_BUTTON } = require('../keyboards');
const { escapeHtml } = require('../lib/format');
const { isManager } = require('../lib/roles');
const logger = require('../lib/logger');

// Confirms in past tense (it's done), then sets the expectation the reader
// would otherwise have to ask about: who replies, and where.
const CLIENT_CONFIRMATION = [
  '✅ <b>Передали менеджеру</b>',
  '',
  'Он свяжется с вами в ближайшее время — ответ придёт сюда, в этот чат.',
].join('\n');

const MANAGER_CONFIRMATION = [
  '✅ <b>Отправлено в рабочий чат</b>',
  '',
  'Ваше обращение видно всем менеджерам группы.',
].join('\n');

/**
 * Who is asking, in the three fields a manager needs before replying: the
 * role (a manager pinging the group is not a client with a problem), the
 * name and phone from the access list, and the Telegram ID.
 *
 * The name is a tg:// link so a manager can open the private chat straight
 * from the group instead of hunting for the person by hand.
 */
function requesterLines(ctx) {
  const account = ctx.state.account;
  const manager = isManager(ctx);
  const name = escapeHtml(account?.full_name || account?.contact_name || ctx.from.first_name || 'Без имени');
  const role = manager ? 'менеджер' : 'клиент';

  return [
    `👤 <a href="tg://user?id=${ctx.from.id}">${name}</a> · ${role}`,
    `📱 ${account?.phone ? `<code>${escapeHtml(account.phone)}</code>` : 'номер не подтверждён'}`,
    `🆔 <code>${ctx.from.id}</code>`,
  ];
}

function registerContactManager(bot) {
  bot.hears(CONTACT_MANAGER_BUTTON, async (ctx) => {
    const manager = isManager(ctx);
    await ctx.reply(manager ? MANAGER_CONFIRMATION : CLIENT_CONFIRMATION, { parse_mode: 'HTML' });

    const lines = [
      manager ? '🔔 <b>Менеджер пишет в чат</b>' : '🔔 <b>Клиент просит связаться</b>',
      '',
      ...requesterLines(ctx),
    ];

    // Managers have no shipments of their own, so listing "заявок нет" for
    // them would only add a line that is always the same.
    if (!manager) {
      const orders = await queries.listOrdersForClient(ctx.from.id);
      const active = orders.filter((o) => o.stage !== 'DELIVERED');
      if (active.length > 0) {
        lines.push('', 'Активные заявки:');
        lines.push(...active.map((o) => `   <code>${escapeHtml(o.order_number)}</code>`));
      } else if (orders.length > 0) {
        lines.push('', '<i>Активных заявок нет</i>');
      } else {
        lines.push('', '<i>Заявок в системе нет</i>');
      }
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

module.exports = { registerContactManager, requesterLines };
