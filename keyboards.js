const { Markup } = require('telegraf');
const { getStageInfo } = require('./db/queries');
const { truncate } = require('./lib/format');

// Reply-keyboard labels. These are matched verbatim by bot.hears(), so the
// emoji is part of the identity — changing one here means changing what the
// bot listens for, nowhere else.
const MY_ORDERS_BUTTON = '📦 Мои заявки';
const ALL_ORDERS_BUTTON = '📋 Все заявки';
const CONTACT_MANAGER_BUTTON = '💬 Связь с менеджером';

const BACK_TO_ORDERS = '‹ К списку заявок';
const BACK_TO_CLIENTS = '‹ К списку клиентов';

/**
 * The bot's only navigation surface, pinned open under the message box.
 * Managers track every client's shipments, so their entry point is "Все
 * заявки" — from there they drill down to any client and any order card.
 */
function mainMenu(isManager = false) {
  const primary = isManager ? ALL_ORDERS_BUTTON : MY_ORDERS_BUTTON;
  return Markup.keyboard([[primary, CONTACT_MANAGER_BUTTON]])
    .resize()
    .persistent();
}

/** Label an order so it's identifiable without opening it. */
function orderButtonLabel(order) {
  const emoji = getStageInfo(order.stage).emoji;
  const cargo = order.cargo_description ? ` · ${truncate(order.cargo_description, 30)}` : '';
  return `${emoji} ${order.order_number}${cargo}`;
}

function ordersList(orders) {
  return Markup.inlineKeyboard(
    orders.map((o) => [Markup.button.callback(orderButtonLabel(o), `order:${o.order_number}`)])
  );
}

function backToOrdersList() {
  return Markup.inlineKeyboard([[Markup.button.callback(BACK_TO_ORDERS, 'orders:list')]]);
}

// --- manager drill-down ---
//
// A group is keyed by ANY one of its order numbers: every order carries its
// client, so re-deriving the group from one order number is exact, and the
// key stays short enough for Telegram's 64-byte callback_data limit (a raw
// username would not be, and row indexes would go stale between renders).

function managerClientsList(groups) {
  const rows = groups.map((g) => {
    const name = g.name || 'Без имени';
    // Two flags the manager acts on: 💰 someone still owes money, ⚠️ someone
    // cannot be reached because they never opened the bot.
    const flags = `${g.due > 0 ? ' 💰' : ''}${g.telegramId == null ? ' ⚠️' : ''}`;
    const label = `👤 ${truncate(name, 18)} · 🚚 ${g.active.length} · ✅ ${g.delivered.length}${flags}`;
    return [Markup.button.callback(label, `mgr:g:${g.keyOrderNumber}`)];
  });
  return Markup.inlineKeyboard(rows);
}

function managerClientOrders(orders) {
  const rows = orders.map((o) => [Markup.button.callback(orderButtonLabel(o), `mgr:o:${o.order_number}`)]);
  rows.push([Markup.button.callback(BACK_TO_CLIENTS, 'mgr:all')]);
  return Markup.inlineKeyboard(rows);
}

/** Back from an order card to the list of that same client's orders. */
function managerBackToClient(orderNumber) {
  return Markup.inlineKeyboard([[Markup.button.callback(BACK_TO_ORDERS, `mgr:g:${orderNumber}`)]]);
}

module.exports = {
  MY_ORDERS_BUTTON,
  ALL_ORDERS_BUTTON,
  CONTACT_MANAGER_BUTTON,
  mainMenu,
  ordersList,
  backToOrdersList,
  managerClientsList,
  managerClientOrders,
  managerBackToClient,
};
