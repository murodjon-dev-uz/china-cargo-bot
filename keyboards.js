const { Markup } = require('telegraf');

const MY_ORDERS_BUTTON = 'Мои заявки';
const CONTACT_MANAGER_BUTTON = 'Связь с менеджером';
const BACK_BUTTON = '⬅️ Назад';

function mainMenu() {
  return Markup.keyboard([[MY_ORDERS_BUTTON, CONTACT_MANAGER_BUTTON]]).resize();
}

function ordersList(activeOrders, historyOrders) {
  const rows = [];
  if (activeOrders.length > 0) {
    rows.push([Markup.button.callback('— Активные —', 'noop')]);
    for (const o of activeOrders) {
      rows.push([Markup.button.callback(`${o.emoji || ''} ${o.order_number}`.trim(), `order:${o.order_number}`)]);
    }
  }
  if (historyOrders.length > 0) {
    rows.push([Markup.button.callback('— История —', 'noop')]);
    for (const o of historyOrders) {
      rows.push([Markup.button.callback(`${o.emoji || ''} ${o.order_number}`.trim(), `order:${o.order_number}`)]);
    }
  }
  return Markup.inlineKeyboard(rows);
}

function backToOrdersList() {
  return Markup.inlineKeyboard([[Markup.button.callback(BACK_BUTTON, 'orders:list')]]);
}

function statusPicker(statusCatalog, orderNumber) {
  const rows = statusCatalog.map((s) => [
    Markup.button.callback(`${s.emoji || ''} ${s.label_ru}`.trim(), `setstatus:${orderNumber}:${s.code}`),
  ]);
  return Markup.inlineKeyboard(rows);
}

module.exports = {
  MY_ORDERS_BUTTON,
  CONTACT_MANAGER_BUTTON,
  mainMenu,
  ordersList,
  backToOrdersList,
  statusPicker,
};
