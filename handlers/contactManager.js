const config = require('../config');
const queries = require('../db/queries');
const { CONTACT_MANAGER_BUTTON } = require('../keyboards');
const logger = require('../lib/logger');

function registerContactManager(bot) {
  bot.hears(CONTACT_MANAGER_BUTTON, async (ctx) => {
    await ctx.reply('Ваш запрос передан менеджеру, мы свяжемся с вами в ближайшее время.');

    const who = ctx.from.username ? `@${ctx.from.username}` : `id ${ctx.from.id}`;
    const orders = queries.listOrdersForClient(ctx.from.id);
    const orderNote = orders.length > 0 ? ` (заявки: ${orders.map((o) => o.order_number).join(', ')})` : '';
    try {
      await ctx.telegram.sendMessage(
        config.managerGroupChatId,
        `Клиент ${who}${orderNote} просит связаться.`
      );
    } catch (err) {
      logger.error('Failed to notify manager group', err.message);
    }
  });
}

module.exports = { registerContactManager };
