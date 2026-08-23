const queries = require('../db/queries');
const { MY_ORDERS_BUTTON, ordersList, backToOrdersList } = require('../keyboards');
const { formatDateRu, formatDateTimeRu } = require('../lib/format');

function renderOrdersList(ctx) {
  const orders = queries.listOrdersForClient(ctx.from.id);
  if (orders.length === 0) {
    return ctx.reply('У вас пока нет заявок. Если это не так, свяжитесь с менеджером.');
  }
  return ctx.reply('Ваши заявки:', ordersList(orders));
}

function renderOrderDetail(ctx, orderNumber) {
  const order = queries.findOrder(orderNumber);
  if (!order || order.telegram_id !== ctx.from.id) {
    return ctx.answerCbQuery('Заявка не найдена', { show_alert: true });
  }
  const history = queries.getOrderHistory(orderNumber);
  const stageInfo = queries.getStageInfo(order.stage);

  const lines = [
    `📦 Заявка ${order.order_number}`,
    order.cargo_description ? `Груз: ${order.cargo_description}` : null,
    order.route ? `Маршрут: ${order.route}` : null,
    `Этап: ${stageInfo.emoji} ${stageInfo.label}`,
    order.current_status ? `Статус: ${order.current_status}` : null,
    order.current_comment ? `Сообщение: ${order.current_comment}` : null,
    order.eta_date ? `Прогноз прибытия: ${formatDateRu(order.eta_date)}` : null,
    '',
    'История:',
    ...history.map(
      (h) => `${formatDateTimeRu(h.changed_at)} — ${h.status_text}${h.comment ? ` (${h.comment})` : ''}`
    ),
  ].filter((l) => l !== null);

  return ctx.editMessageText(lines.join('\n'), backToOrdersList());
}

function registerMyOrders(bot) {
  bot.hears(MY_ORDERS_BUTTON, renderOrdersList);

  bot.action(/^order:(.+)$/, (ctx) => {
    const orderNumber = ctx.match[1];
    return renderOrderDetail(ctx, orderNumber);
  });

  bot.action('orders:list', (ctx) => {
    const orders = queries.listOrdersForClient(ctx.from.id);
    return ctx.editMessageText('Ваши заявки:', ordersList(orders));
  });

  bot.action('noop', (ctx) => ctx.answerCbQuery());
}

module.exports = { registerMyOrders };
