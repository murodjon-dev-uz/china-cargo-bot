const queries = require('../db/queries');
const { MY_ORDERS_BUTTON, ordersList, backToOrdersList } = require('../keyboards');
const { formatDateRu, formatDateTimeRu } = require('../lib/format');

function renderOrdersList(ctx) {
  const orders = queries.listOrdersForClient(ctx.from.id);
  if (orders.length === 0) {
    return ctx.reply('У вас пока нет заявок. Если это не так, свяжитесь с менеджером.');
  }
  const active = orders.filter((o) => !o.is_final);
  const history = orders.filter((o) => o.is_final);
  return ctx.reply('Ваши заявки:', ordersList(active, history));
}

function renderOrderDetail(ctx, orderNumber) {
  const order = queries.findOrder(orderNumber);
  if (!order || order.telegram_id !== ctx.from.id) {
    return ctx.answerCbQuery('Заявка не найдена', { show_alert: true });
  }
  const status = queries.getStatus(order.current_status_code);
  const history = queries.getOrderHistory(orderNumber);

  const lines = [
    `📦 Заявка ${order.order_number}`,
    order.cargo_description ? `Груз: ${order.cargo_description}` : null,
    order.route ? `Маршрут: ${order.route}` : null,
    `Статус: ${status ? `${status.emoji || ''} ${status.label_ru}`.trim() : 'неизвестен'}`,
    order.current_comment ? `Комментарий: ${order.current_comment}` : null,
    order.eta_date ? `Прогноз прибытия: ${formatDateRu(order.eta_date)}` : null,
    '',
    'История:',
    ...history.map(
      (h) => `${formatDateTimeRu(h.changed_at)} — ${h.emoji || ''} ${h.label_ru}${h.comment ? ` (${h.comment})` : ''}`
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
    const active = orders.filter((o) => !o.is_final);
    const history = orders.filter((o) => o.is_final);
    return ctx.editMessageText('Ваши заявки:', ordersList(active, history));
  });

  bot.action('noop', (ctx) => ctx.answerCbQuery());
}

module.exports = { registerMyOrders };
