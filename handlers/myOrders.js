const queries = require('../db/queries');
const { MY_ORDERS_BUTTON, ordersList, backToOrdersList } = require('../keyboards');
const { isManager } = require('../lib/roles');
const {
  formatDateRu,
  formatDateShortRu,
  formatEtaCountdown,
  pluralOrders,
  escapeHtml,
} = require('../lib/format');

/**
 * Most-relevant-first: shipments still on the way (soonest arrival at the
 * top, because that's the one the client is waiting on), then delivered ones
 * newest-first as a receipt trail.
 */
function sortForClient(orders) {
  const active = orders.filter((o) => o.stage !== 'DELIVERED');
  const delivered = orders.filter((o) => o.stage === 'DELIVERED');
  active.sort((a, b) => String(a.eta_date || '9999').localeCompare(String(b.eta_date || '9999')));
  delivered.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  return { active, delivered, ordered: [...active, ...delivered] };
}

function ordersListText(active, delivered) {
  const lines = ['📦 <b>Ваши заявки</b>', ''];
  if (active.length > 0) lines.push(`🚚 В пути — ${active.length} ${pluralOrders(active.length)}`);
  if (delivered.length > 0) lines.push(`✅ Доставлено — ${delivered.length} ${pluralOrders(delivered.length)}`);
  lines.push('', 'Нажмите на заявку, чтобы посмотреть путь груза.');
  return lines.join('\n');
}

// Answers the two questions the reader actually has: why is this blank, and
// what do I do about it — which differs by role, since a manager looking at
// an empty personal list wants pointing at the all-clients view instead.
function emptyState(forManager) {
  return forManager
    ? [
        '📦 <b>Личных заявок нет</b>',
        '',
        'Здесь появятся заявки, оформленные на ваш аккаунт.',
        '',
        'Грузы клиентов — на кнопке «📋 Все заявки».',
      ].join('\n')
    : [
        '📦 <b>Заявок пока нет</b>',
        '',
        'Как только менеджер оформит заявку, она появится здесь.',
        '',
        'Уже отправили груз? Нажмите «💬 Связь с менеджером» — проверим.',
      ].join('\n');
}

function renderOrdersList(ctx) {
  const orders = queries.listOrdersForClient(ctx.from.id);
  if (orders.length === 0) {
    return ctx.reply(emptyState(isManager(ctx.from.id)), { parse_mode: 'HTML' });
  }
  const { active, delivered, ordered } = sortForClient(orders);
  return ctx.reply(ordersListText(active, delivered), {
    parse_mode: 'HTML',
    ...ordersList(ordered),
  });
}

/**
 * Renders the shipment's history as a checklist so progress is visible at a
 * glance: every step done is ticked, the step it's on right now is marked.
 * Long journeys go inside an expandable quote — the card stays scannable and
 * the full trail is one tap away.
 */
function renderTimeline(history, isDelivered) {
  const rows = history.map((h, i) => {
    const isLast = i === history.length - 1;
    const marker = isLast && !isDelivered ? '●' : '✓';
    const date = formatDateShortRu(h.changed_at);
    return `${marker} ${date} · ${escapeHtml(h.status_text)}`;
  });
  const body = rows.join('\n');
  return rows.length > 4 ? `<blockquote expandable>${body}</blockquote>` : body;
}

function orderDetailText(order, history) {
  const stage = queries.getStageInfo(order.stage);
  const isDelivered = order.stage === 'DELIVERED';

  const lines = [`📦 <b>${escapeHtml(order.order_number)}</b>`];
  if (order.cargo_description) lines.push(escapeHtml(order.cargo_description));
  lines.push('');

  // The single most important line: where the cargo is, in the manager's own words.
  const headline = order.current_status || `${stage.emoji} ${stage.label}`;
  lines.push(`<b>${escapeHtml(headline)}</b>`);
  lines.push('');

  if (order.route) lines.push(`Маршрут: ${escapeHtml(order.route)}`);
  if (isDelivered) {
    // The headline already says it's delivered — this line adds the fact the
    // client would otherwise have to dig out of the timeline: when.
    const deliveredAt = history.length > 0 ? history[history.length - 1].changed_at : order.updated_at;
    lines.push(`Доставлен: ${formatDateRu(deliveredAt)}`);
  } else if (order.eta_date) {
    const countdown = formatEtaCountdown(order.eta_date);
    lines.push(`Прибытие: ${formatDateRu(order.eta_date)}${countdown ? ` · <b>${countdown}</b>` : ''}`);
  }

  if (history.length > 0) {
    lines.push('', '<b>Путь груза</b>', renderTimeline(history, isDelivered));
  }

  return lines.join('\n');
}

async function renderOrderDetail(ctx, orderNumber) {
  const order = queries.findOrder(orderNumber);
  if (!order || order.telegram_id !== ctx.from.id) {
    return ctx.answerCbQuery('Заявка не найдена', { show_alert: true });
  }
  const history = queries.getOrderHistory(orderNumber);

  // Clear the button's spinner first, so the tap feels instantly acknowledged
  // instead of hanging until the message finishes re-rendering.
  await ctx.answerCbQuery();
  return ctx.editMessageText(orderDetailText(order, history), {
    parse_mode: 'HTML',
    ...backToOrdersList(),
  });
}

function registerMyOrders(bot) {
  bot.hears(MY_ORDERS_BUTTON, renderOrdersList);

  bot.action(/^order:(.+)$/, (ctx) => renderOrderDetail(ctx, ctx.match[1]));

  bot.action('orders:list', async (ctx) => {
    const orders = queries.listOrdersForClient(ctx.from.id);
    await ctx.answerCbQuery();
    if (orders.length === 0) {
      return ctx.editMessageText(emptyState(isManager(ctx.from.id)), { parse_mode: 'HTML' });
    }
    const { active, delivered, ordered } = sortForClient(orders);
    return ctx.editMessageText(ordersListText(active, delivered), {
      parse_mode: 'HTML',
      ...ordersList(ordered),
    });
  });

  bot.action('noop', (ctx) => ctx.answerCbQuery());
}

module.exports = { registerMyOrders };
