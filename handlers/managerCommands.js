const queries = require('../db/queries');
const logger = require('../lib/logger');
const { isManager } = require('../lib/roles');
const { escapeHtml, truncate, pluralOrders } = require('../lib/format');
const {
  ALL_ORDERS_BUTTON,
  MY_ORDERS_BUTTON,
  CONTACT_MANAGER_BUTTON,
} = require('../keyboards');

// In-memory, process-local — fine to lose on restart, it's just "awaiting a status text" state
// for the rare manual/emergency status-change flow.
const pendingStatus = new Map(); // managerTelegramId -> orderNumber

// Telegram caps one message at 4096 characters; stay well under so a client
// block is never cut mid-line.
const MAX_MESSAGE_LEN = 3500;

/**
 * Groups every order by client and renders each as an active/delivered
 * block. Clients who haven't opened the bot yet are still listed (under
 * their spreadsheet username) so nothing silently disappears from the
 * overview — the manager needs to see those precisely because they're the
 * ones who can't get notifications yet.
 */
function buildClientGroups() {
  const orders = queries.listAllOrdersForOverview();
  const groups = new Map();

  for (const o of orders) {
    const key = o.telegram_id != null ? `id:${o.telegram_id}` : `un:${o.bound_username || '—'}`;
    if (!groups.has(key)) {
      groups.set(key, {
        username: o.bound_username || null,
        telegramId: o.telegram_id,
        active: [],
        delivered: [],
      });
    }
    const group = groups.get(key);
    (o.stage === 'DELIVERED' ? group.delivered : group.active).push(o);
  }

  for (const group of groups.values()) {
    group.active.sort((a, b) => String(a.eta_date || '9999').localeCompare(String(b.eta_date || '9999')));
    group.delivered.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  }
  return groups;
}

function orderLine(order) {
  const status = order.current_status ? ` · ${escapeHtml(truncate(order.current_status, 42))}` : '';
  return `   <code>${escapeHtml(order.order_number)}</code>${status}`;
}

function renderClientBlock(group) {
  const name = group.username ? `@${escapeHtml(group.username)}` : 'Без имени';
  const identity = group.telegramId != null
    ? `<b>👤 ${name}</b>\n   ID <code>${group.telegramId}</code>`
    : `<b>👤 ${name}</b>\n   <i>ещё не открыл бота — уведомления не приходят</i>`;

  const lines = [identity, ''];

  lines.push(`🚚 <b>В пути</b> — ${group.active.length}`);
  lines.push(...(group.active.length > 0 ? group.active.map(orderLine) : ['   —']));

  lines.push('', `✅ <b>Доставлено</b> — ${group.delivered.length}`);
  lines.push(...(group.delivered.length > 0 ? group.delivered.map(orderLine) : ['   —']));

  return lines.join('\n');
}

/** Returns an array of ready-to-send messages, packed to fit Telegram's limit. */
function renderAllOrdersOverview() {
  const groups = buildClientGroups();
  if (groups.size === 0) {
    return ['📋 <b>Заявок пока нет</b>\n\nЗаявки появятся здесь, как только их добавят в Google-таблицу.'];
  }

  let totalActive = 0;
  let totalDelivered = 0;
  for (const g of groups.values()) {
    totalActive += g.active.length;
    totalDelivered += g.delivered.length;
  }
  const total = totalActive + totalDelivered;

  const header = [
    `📋 <b>Все заявки</b> — ${total} ${pluralOrders(total)}`,
    `🚚 В пути — ${totalActive}   ✅ Доставлено — ${totalDelivered}`,
    `👥 Клиентов — ${groups.size}`,
  ].join('\n');

  const blocks = [...groups.values()].map(renderClientBlock);

  const messages = [];
  let current = header;
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

async function sendAllOrders(ctx) {
  // A visible "typing" beat while we build and send several messages, so the
  // tap never feels like it did nothing.
  await ctx.sendChatAction('typing').catch(() => {});
  for (const message of renderAllOrdersOverview()) {
    await ctx.reply(message, { parse_mode: 'HTML' });
  }
}

function registerManagerCommands(bot) {
  bot.hears(ALL_ORDERS_BUTTON, (ctx) => {
    if (!isManager(ctx.from.id)) return; // silently ignore non-managers
    return sendAllOrders(ctx);
  });
  bot.command('all_orders', (ctx) => {
    if (!isManager(ctx.from.id)) return;
    return sendAllOrders(ctx);
  });

  bot.command('status', (ctx) => {
    if (!isManager(ctx.from.id)) return; // silently ignore non-managers

    const orderNumber = ctx.message.text.split(/\s+/)[1];
    if (!orderNumber) {
      return ctx.reply('Укажите номер заявки: <code>/status CRG-0001</code>', { parse_mode: 'HTML' });
    }
    const order = queries.findOrder(orderNumber);
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
    if (!isManager(ctx.from.id)) return next();
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
  queries.withTransaction(() => {
    queries.updateOrderStatus({ orderNumber, statusText, comment: null });
    queries.appendStatusHistory({ orderNumber, statusText, comment: null, source: 'manual_manager_command' });
    queries.recordManagerAction({
      managerTelegramId: ctx.from.id,
      orderNumber,
      statusText,
      comment: null,
    });
  });

  const order = queries.findOrder(orderNumber);
  let notified = false;
  if (order.telegram_id) {
    try {
      await ctx.telegram.sendMessage(order.telegram_id, `📦 <b>${escapeHtml(orderNumber)}</b> — новый статус\n\n${escapeHtml(statusText)}`, { parse_mode: 'HTML' });
      notified = true;
    } catch (err) {
      logger.error('Manual status: failed to notify client', order.telegram_id, err.message);
    }
  }

  const confirmation = notified
    ? `✅ Статус обновлён. Клиент получил уведомление.`
    : `✅ Статус обновлён. Клиент ещё не открыл бота — уведомление не ушло.`;
  return ctx.reply(confirmation);
}

module.exports = { registerManagerCommands, isManager };
