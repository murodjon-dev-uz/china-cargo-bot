const { Markup } = require('telegraf');
const { getStageInfo } = require('./db/queries');
const { truncate } = require('./lib/format');

// Reply-keyboard labels. These are matched verbatim by bot.hears(), so the
// emoji is part of the identity — changing one here means changing what the
// bot listens for, nowhere else.
const MY_ORDERS_BUTTON = '📦 Мои заявки';
const ALL_ORDERS_BUTTON = '📋 Все заявки';
const CONTACT_MANAGER_BUTTON = '💬 Связь с менеджером';

const BACK_BUTTON = '‹ К списку заявок';

/**
 * The bot's only navigation surface, pinned open under the message box.
 * Managers and the owner track every client's shipments, so their primary
 * action is "Все заявки" — they never have orders of their own to look at.
 */
function mainMenu(isManager = false) {
  const primary = isManager ? ALL_ORDERS_BUTTON : MY_ORDERS_BUTTON;
  return Markup.keyboard([[primary, CONTACT_MANAGER_BUTTON]])
    .resize()
    .persistent();
}

/**
 * One button per order, labelled so it is identifiable without opening it:
 * stage emoji (where it is) + number (which one) + cargo (what it is).
 */
function ordersList(orders) {
  const rows = orders.map((o) => {
    const emoji = getStageInfo(o.stage).emoji;
    const cargo = o.cargo_description ? ` · ${truncate(o.cargo_description, 30)}` : '';
    return [Markup.button.callback(`${emoji} ${o.order_number}${cargo}`, `order:${o.order_number}`)];
  });
  return Markup.inlineKeyboard(rows);
}

function backToOrdersList() {
  return Markup.inlineKeyboard([[Markup.button.callback(BACK_BUTTON, 'orders:list')]]);
}

module.exports = {
  MY_ORDERS_BUTTON,
  ALL_ORDERS_BUTTON,
  CONTACT_MANAGER_BUTTON,
  mainMenu,
  ordersList,
  backToOrdersList,
};
