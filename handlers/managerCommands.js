const queries = require('../db/queries');
const config = require('../config');
const logger = require('../lib/logger');
const { isManager } = require('../lib/roles');
const { escapeHtml, truncate, pluralOrders, pluralClients, parseDecimal, formatMoney } = require('../lib/format');
const { sortByRelevance, renderOrderCard } = require('../lib/orderCard');
const {
  ALL_ORDERS_BUTTON,
  MY_ORDERS_BUTTON,
  CONTACT_MANAGER_BUTTON,
  managerClientsList,
  managerClientOrders,
  managerBackToClient,
} = require('../keyboards');

// In-memory, process-local — fine to lose on restart, it's just "awaiting a status text" state
// for the rare manual/emergency status-change flow.
const pendingStatus = new Map(); // managerTelegramId -> orderNumber

// Telegram caps one message at 4096 characters; stay well under so a client
// block is never cut mid-line in the /all_orders text export.
const MAX_MESSAGE_LEN = 3500;

/**
 * Every order grouped by client, ordered most-relevant-first within each
 * group. Clients who haven't opened the bot yet are grouped by their
 * spreadsheet phone and flagged — the manager needs to see exactly those,
 * because they're the ones who can't receive notifications.
 *
 * Each group carries `keyOrderNumber` (any one of its orders) as its
 * callback-data key: order numbers are short and re-derive the group exactly,
 * unlike row indexes (which go stale between renders).
 */
async function buildClientGroups() {
  const byClient = new Map();

  for (const o of await queries.listAllOrdersForOverview()) {
    const key = o.telegram_id != null ? `id:${o.telegram_id}` : `ph:${o.bound_phone || o.order_number}`;
    if (!byClient.has(key)) {
      byClient.set(key, { name: o.client_name || null, phone: o.bound_phone || null, telegramId: o.telegram_id, orders: [] });
    }
    byClient.get(key).orders.push(o);
  }

  return [...byClient.values()].map((g) => {
    const { active, delivered, ordered } = sortByRelevance(g.orders);
    return { ...g, active, delivered, ordered, keyOrderNumber: ordered[0].order_number, ...moneyTotals(g.orders) };
  });
}

/**
 * What is owed across a set of orders. Overpayments on one order must not
 * cancel out a debt on another, so each order's remainder is floored at zero
 * before being added up — otherwise a client with one prepaid shipment would
 * look settled while still owing money on the next.
 */
function moneyTotals(orders) {
  // One switch for every money surface: with payments hidden the totals come
  // back zeroed, which drops the overview block, the per-client debt line and
  // the 💰 flag on the buttons without a condition at each of them.
  if (!config.paymentsEnabled) return { billed: 0, paid: 0, due: 0, currency: null };
  let billed = 0;
  let paid = 0;
  let due = 0;
  let currency = null;
  for (const o of orders) {
    const price = parseDecimal(o.price) || 0;
    const settled = parseDecimal(o.paid) || 0;
    billed += price;
    paid += settled;
    due += Math.max(0, price - settled);
    if (!currency && o.currency) currency = o.currency;
  }
  const round = (n) => Math.round(n * 100) / 100;
  return { billed: round(billed), paid: round(paid), due: round(due), currency };
}

/** Re-derives a client's group from any single order number they own. */
async function findGroupByOrder(orderNumber) {
  const order = await queries.findOrder(orderNumber);
  if (!order) return null;
  return (await buildClientGroups()).find((g) =>
    order.telegram_id != null
      ? g.telegramId === order.telegram_id
      : g.telegramId == null && g.phone === order.bound_phone
  ) || null;
}

function clientIdentityLines(group) {
  const name = group.name ? escapeHtml(group.name) : 'Без имени';
  // Full number, not masked: the manager is the person who has to ring it,
  // and they already have the whole column open in the spreadsheet.
  const phone = group.phone ? `<code>${escapeHtml(group.phone)}</code>` : 'телефон не указан';
  const lines = group.telegramId != null
    ? [`<b>👤 ${name}</b>`, phone]
    : [`<b>👤 ${name}</b>`, phone, '<i>ещё не открыл бота — уведомления не приходят</i>'];
  if (group.due > 0) lines.push(`💰 Долг: <b>${escapeHtml(formatMoney(group.due, group.currency))}</b>`);
  else if (group.billed > 0) lines.push('💰 Оплачено полностью ✅');
  return lines;
}

// --- level 1: clients ---

async function clientsOverview() {
  const groups = await buildClientGroups();
  if (groups.length === 0) {
    return {
      text: '📋 <b>Заявок пока нет</b>\n\nЗаявки появятся здесь, как только их добавят в Google-таблицу.',
      extra: {},
    };
  }

  const totalActive = groups.reduce((n, g) => n + g.active.length, 0);
  const totalDelivered = groups.reduce((n, g) => n + g.delivered.length, 0);
  const total = totalActive + totalDelivered;

  const money = moneyTotals(groups.flatMap((g) => g.ordered));
  const debtors = groups.filter((g) => g.due > 0).length;

  const lines = [
    `📋 <b>Все заявки</b> — ${total} ${pluralOrders(total)}`,
    '',
    `🚚 В пути — ${totalActive}`,
    `✅ Доставлено — ${totalDelivered}`,
    `👥 Клиентов — ${groups.length}`,
  ];
  if (money.billed > 0) {
    lines.push(
      '',
      `💵 Выставлено — ${escapeHtml(formatMoney(money.billed, money.currency))}`,
      `✅ Оплачено — ${escapeHtml(formatMoney(money.paid, money.currency))}`,
      money.due > 0
        ? `💰 Долг — <b>${escapeHtml(formatMoney(money.due, money.currency))}</b> · ${debtors} ${pluralClients(debtors)}`
        : '💰 Долгов нет'
    );
  }
  lines.push('', 'Выберите клиента, чтобы посмотреть его заявки.');
  const text = lines.join('\n');

  return { text, extra: managerClientsList(groups) };
}

// --- level 2: one client's orders ---

async function clientOrdersView(orderNumber) {
  const group = await findGroupByOrder(orderNumber);
  if (!group) return null;

  const lines = [...clientIdentityLines(group), ''];
  if (group.active.length > 0) {
    lines.push(`🚚 В пути — ${group.active.length} ${pluralOrders(group.active.length)}`);
  }
  if (group.delivered.length > 0) {
    lines.push(`✅ Доставлено — ${group.delivered.length} ${pluralOrders(group.delivered.length)}`);
  }
  lines.push('', 'Нажмите на заявку, чтобы посмотреть путь груза.');

  return { text: lines.join('\n'), extra: managerClientOrders(group.ordered) };
}

// --- text export (the full overview in one scrollable dump) ---

async function renderTextExport() {
  const groups = await buildClientGroups();
  if (groups.length === 0) return ['📋 <b>Заявок пока нет</b>'];

  const orderLine = (o) => {
    const status = o.current_status ? ` · ${escapeHtml(truncate(o.current_status, 42))}` : '';
    return `   <code>${escapeHtml(o.order_number)}</code>${status}`;
  };

  const blocks = groups.map((g) => {
    const lines = [...clientIdentityLines(g), ''];
    lines.push(`🚚 <b>В пути</b> — ${g.active.length}`);
    lines.push(...(g.active.length > 0 ? g.active.map(orderLine) : ['   —']));
    lines.push('', `✅ <b>Доставлено</b> — ${g.delivered.length}`);
    lines.push(...(g.delivered.length > 0 ? g.delivered.map(orderLine) : ['   —']));
    return lines.join('\n');
  });

  const total = groups.reduce((n, g) => n + g.ordered.length, 0);
  const messages = [];
  let current = `📋 <b>Все заявки</b> — ${total} ${pluralOrders(total)}`;
  for (const block of blocks) {
    const candidate = `${current}\n\n${block}`;
    if (candidate.length > MAX_MESSAGE_LEN) {
      messages.push(current);
      current = block;
    } else {
      current = candidate;
    }
  }
  if (current) messages.push(current);
  return messages;
}

function registerManagerCommands(bot) {
  bot.hears(ALL_ORDERS_BUTTON, async (ctx) => {
    if (!isManager(ctx)) return; // silently ignore non-managers
    const { text, extra } = await clientsOverview();
    return ctx.reply(text, { parse_mode: 'HTML', ...extra });
  });

  bot.action('mgr:all', async (ctx) => {
    if (!isManager(ctx)) return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    const { text, extra } = await clientsOverview();
    return ctx.editMessageText(text, { parse_mode: 'HTML', ...extra });
  });

  bot.action(/^mgr:g:(.+)$/, async (ctx) => {
    if (!isManager(ctx)) return ctx.answerCbQuery();
    const view = await clientOrdersView(ctx.match[1]);
    if (!view) return ctx.answerCbQuery('Клиент не найден', { show_alert: true });
    await ctx.answerCbQuery();
    return ctx.editMessageText(view.text, { parse_mode: 'HTML', ...view.extra });
  });

  // Managers open any client's order in the same card the client sees, so
  // what they check on the phone is exactly what the client is looking at.
  bot.action(/^mgr:o:(.+)$/, async (ctx) => {
    if (!isManager(ctx)) return ctx.answerCbQuery();
    const orderNumber = ctx.match[1];
    const order = await queries.findOrder(orderNumber);
    if (!order) return ctx.answerCbQuery('Заявка не найдена', { show_alert: true });
    await ctx.answerCbQuery();
    return ctx.editMessageText(renderOrderCard(order, await queries.getOrderHistory(orderNumber)), {
      parse_mode: 'HTML',
      ...managerBackToClient(orderNumber),
    });
  });

  // Full text export — everything at once, for scanning or copying out.
  bot.command('all_orders', async (ctx) => {
    if (!isManager(ctx)) return;
    await ctx.sendChatAction('typing').catch(() => {});
    for (const message of await renderTextExport()) {
      await ctx.reply(message, { parse_mode: 'HTML' });
    }
  });

  bot.command('status', async (ctx) => {
    if (!isManager(ctx)) return; // silently ignore non-managers

    const orderNumber = ctx.message.text.split(/\s+/)[1];
    if (!orderNumber) {
      return ctx.reply('Укажите номер заявки: <code>/status CRG-0001</code>', { parse_mode: 'HTML' });
    }
    const order = await queries.findOrder(orderNumber);
    if (!order) {
      return ctx.reply(`Заявка ${orderNumber} не найдена. Проверьте номер в таблице.`);
    }
    pendingStatus.set(ctx.from.id, orderNumber);
    return ctx.reply(
      `Напишите новый статус для <code>${escapeHtml(orderNumber)}</code>.\nКлиент увидит его дословно.`,
      { parse_mode: 'HTML' }
    );
  });

  // Plain-text status reply — this is a manager-only exception to
  // "no free text" (see plan §8); the text becomes exactly what the client sees.
  bot.on('text', async (ctx, next) => {
    if (!isManager(ctx)) return next();
    const orderNumber = pendingStatus.get(ctx.from.id);
    if (!orderNumber) return next();
    // A menu tap is navigation, not a status — don't publish "📋 Все заявки"
    // to a client because the manager changed their mind mid-flow.
    if ([ALL_ORDERS_BUTTON, MY_ORDERS_BUTTON, CONTACT_MANAGER_BUTTON].includes(ctx.message.text)) {
      return next();
    }
    pendingStatus.delete(ctx.from.id);
    await applyManualStatus(ctx, orderNumber, ctx.message.text);
  });
}

async function applyManualStatus(ctx, orderNumber, statusText) {
  await queries.withTransaction(async (client) => {
    await queries.updateOrderStatus({ orderNumber, statusText, comment: null }, client);
    await queries.appendStatusHistory({ orderNumber, statusText, comment: null, source: 'manual_manager_command' }, client);
    await queries.recordManagerAction({
      managerTelegramId: ctx.from.id,
      orderNumber,
      statusText,
      comment: null,
    }, client);
  });

  const order = await queries.findOrder(orderNumber);
  let notified = false;
  if (order.telegram_id) {
    try {
      await ctx.telegram.sendMessage(
        order.telegram_id,
        `📦 <b>${escapeHtml(orderNumber)}</b> — новый статус\n\n${escapeHtml(statusText)}`,
        { parse_mode: 'HTML' }
      );
      notified = true;
    } catch (err) {
      logger.error('Manual status: failed to notify client', order.telegram_id, err.message);
    }
  }

  return ctx.reply(
    notified
      ? '✅ Статус обновлён. Клиент получил уведомление.'
      : '✅ Статус обновлён. Клиент ещё не открыл бота — уведомление не ушло.'
  );
}

module.exports = { registerManagerCommands, isManager };
