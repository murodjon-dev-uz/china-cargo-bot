// The order card and list summary, shared by the client's own "Мои заявки"
// view and the manager's drill-down into any client's shipment — so what a
// manager checks is byte-for-byte what the client is looking at.
const queries = require('../db/queries');
const {
  formatDateRu,
  formatDateShortRu,
  formatEtaCountdown,
  pluralOrders,
  pluralPackages,
  escapeHtml,
  formatNumberRu,
  formatMoney,
} = require('./format');

/**
 * Most-relevant-first: shipments still on the way (soonest arrival at the
 * top, because that's the one being waited on), then delivered ones
 * newest-first as a receipt trail.
 */
function sortByRelevance(orders) {
  const active = orders.filter((o) => o.stage !== 'DELIVERED');
  const delivered = orders.filter((o) => o.stage === 'DELIVERED');
  active.sort((a, b) => String(a.eta_date || '9999').localeCompare(String(b.eta_date || '9999')));
  delivered.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  return { active, delivered, ordered: [...active, ...delivered] };
}

function renderOrdersSummary(active, delivered, title = '📦 <b>Ваши заявки</b>') {
  const lines = [title, ''];
  if (active.length > 0) lines.push(`🚚 В пути — ${active.length} ${pluralOrders(active.length)}`);
  if (delivered.length > 0) lines.push(`✅ Доставлено — ${delivered.length} ${pluralOrders(delivered.length)}`);
  lines.push('', 'Нажмите на заявку, чтобы посмотреть путь груза.');
  return lines.join('\n');
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
    return `${marker} ${formatDateShortRu(h.changed_at)} · ${escapeHtml(h.status_text)}`;
  });
  const body = rows.join('\n');
  return rows.length > 4 ? `<blockquote expandable>${body}</blockquote>` : body;
}

function renderOrderCard(order, history) {
  const stage = queries.getStageInfo(order.stage);
  const isDelivered = order.stage === 'DELIVERED';

  const lines = [`📦 <b>${escapeHtml(order.order_number)}</b>`];
  if (order.cargo_description) lines.push(escapeHtml(order.cargo_description));
  lines.push('');

  // The single most important line: where the cargo is, in the manager's own words.
  const headline = order.current_status || `${stage.emoji} ${stage.label}`;
  lines.push(`<b>${escapeHtml(headline)}</b>`);
  lines.push('');

  const route = order.origin && order.destination
    ? `${order.origin} → ${order.destination}`
    : order.origin || order.destination || order.route;
  if (route) lines.push(`Маршрут: ${escapeHtml(route)}`);

  // Weight, volume and package count belong on one line: they answer a single
  // question ("how much cargo is this") and each is short enough that three
  // separate rows would only push the timeline further down.
  const measures = [];
  if (order.packages) measures.push(`${formatNumberRu(order.packages, 0)} ${pluralPackages(order.packages)}`);
  if (order.weight_kg) measures.push(`${formatNumberRu(order.weight_kg)} кг`);
  if (order.volume_m3) measures.push(`${formatNumberRu(order.volume_m3)} м³`);
  if (measures.length > 0) lines.push(`Груз: ${measures.join(' · ')}`);

  const price = formatMoney(order.price, order.currency);
  if (price) lines.push(`Стоимость: <b>${escapeHtml(price)}</b>`);
  if (isDelivered) {
    // The headline already says it's delivered — this line adds the fact the
    // reader would otherwise have to dig out of the timeline: when.
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

module.exports = { sortByRelevance, renderOrdersSummary, renderOrderCard };
