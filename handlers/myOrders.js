const queries = require('../db/queries');
const { MY_ORDERS_BUTTON, ordersList, backToOrdersList } = require('../keyboards');
const { sortByRelevance, renderOrdersSummary, renderOrderCard } = require('../lib/orderCard');

// Answers the two questions the reader actually has: why is this blank, and
// what do I do about it.
const EMPTY_STATE = [
  '📦 <b>Заявок пока нет</b>',
  '',
  'Как только менеджер оформит заявку, она появится здесь.',
  '',
  'Уже отправили груз? Нажмите «💬 Связь с менеджером» — проверим.',
].join('\n');

async function ordersView(telegramId) {
  const orders = await queries.listOrdersForClient(telegramId);
  if (orders.length === 0) {
    return { text: EMPTY_STATE, extra: {} };
  }
  const { active, delivered, ordered } = sortByRelevance(orders);
  return { text: renderOrdersSummary(active, delivered), extra: ordersList(ordered) };
}

function registerMyOrders(bot) {
  bot.hears(MY_ORDERS_BUTTON, async (ctx) => {
    const { text, extra } = await ordersView(ctx.from.id);
    return ctx.reply(text, { parse_mode: 'HTML', ...extra });
  });

  bot.action(/^order:(.+)$/, async (ctx) => {
    const orderNumber = ctx.match[1];
    const order = await queries.findOrder(orderNumber);
    // Clients only ever see their own shipments; managers browse every
    // client's orders through their own drill-down (see managerCommands.js).
    if (!order || String(order.telegram_id) !== String(ctx.from.id)) {
      return ctx.answerCbQuery('Заявка не найдена', { show_alert: true });
    }
    // Clear the button's spinner first, so the tap feels instantly acknowledged
    // instead of hanging until the message finishes re-rendering.
    await ctx.answerCbQuery();
    return ctx.editMessageText(renderOrderCard(order, await queries.getOrderHistory(orderNumber)), {
      parse_mode: 'HTML',
      ...backToOrdersList(),
    });
  });

  bot.action('orders:list', async (ctx) => {
    await ctx.answerCbQuery();
    const { text, extra } = await ordersView(ctx.from.id);
    return ctx.editMessageText(text, { parse_mode: 'HTML', ...extra });
  });

  bot.action('noop', (ctx) => ctx.answerCbQuery());
}

module.exports = { registerMyOrders };
