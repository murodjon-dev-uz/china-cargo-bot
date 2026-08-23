const { Markup } = require('telegraf');
const { getStageInfo } = require('./db/queries');

const MY_ORDERS_BUTTON = 'Мои заявки';
const CONTACT_MANAGER_BUTTON = 'Связь с менеджером';
const BACK_BUTTON = '⬅️ Назад';

function mainMenu() {
  return Markup.keyboard([[MY_ORDERS_BUTTON, CONTACT_MANAGER_BUTTON]]).resize();
}

function ordersList(orders) {
  const rows = orders.map((o) => [
    Markup.button.callback(`${getStageInfo(o.stage).emoji} ${o.order_number}`, `order:${o.order_number}`),
  ]);
  return Markup.inlineKeyboard(rows);
}

function backToOrdersList() {
  return Markup.inlineKeyboard([[Markup.button.callback(BACK_BUTTON, 'orders:list')]]);
}

module.exports = {
  MY_ORDERS_BUTTON,
  CONTACT_MANAGER_BUTTON,
  mainMenu,
  ordersList,
  backToOrdersList,
};
