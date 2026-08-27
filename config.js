require('dotenv').config();
const path = require('node:path');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required .env variable: ${name}`);
  return value;
}

module.exports = {
  botToken: required('BOT_TOKEN'),
  managerGroupChatId: Number(required('MANAGER_GROUP_CHAT_ID')),
  // Optional: forum-topic thread ID within the manager group (from a
  // t.me/c/<group>/<topic_id> link). Omit to post to the group's general
  // stream instead of a specific topic.
  managerGroupTopicId: process.env.MANAGER_GROUP_TOPIC_ID
    ? Number(process.env.MANAGER_GROUP_TOPIC_ID)
    : null,
  spreadsheetId: required('SPREADSHEET_ID'),
  googleServiceAccountKeyPath: path.resolve(required('GOOGLE_SERVICE_ACCOUNT_KEY_PATH')),
  webhookSecret: required('WEBHOOK_SECRET'),
  databaseUrl: required('DATABASE_URL'),
  databaseSsl: process.env.DATABASE_SSL === 'true',
  port: Number(process.env.PORT || 3000),
  logLevel: process.env.LOG_LEVEL || 'info',
  timezone: process.env.TZ || 'Asia/Tashkent',
  sheets: {
    ordersTab: 'Заявки',
    trackingTab: 'Трекинг',
    // Access list. Managers fill "Имя клиента" and "Номер телефона" by hand;
    // only a phone present here can log into the bot. The last two columns
    // are written back by the sync layer, never by the bot itself.
    contactsTab: 'Контакты',
    // Same four columns as "Контакты". Being on this tab instead is the only
    // thing that makes someone a manager.
    managersTab: 'Менеджеры',
    contactNameCol: 'Имя клиента',
    contactPhoneCol: 'Номер телефона',
    contactStatusCol: 'Статус',
    contactJoinedCol: 'Дата входа',
    orderNumberCol: 'Cargo ID',
    clientCol: 'Client',
    phoneCol: 'Телефон',
    cargoCol: 'Cargo',
    routeCol: 'Route',
    etaCol: 'ETA',
    originCol: 'Откуда',
    destinationCol: 'Куда',
    weightCol: 'Вес (кг)',
    volumeCol: 'Объём (м³)',
    packagesCol: 'Мест',
    priceCol: 'Цена',
    currencyCol: 'Валюта',
    // Payment ledger: one row per payment, several rows per order.
    paymentsTab: 'Оплаты',
    paymentDateCol: 'Дата',
    paymentAmountCol: 'Сумма',
    paymentNoteCol: 'Примечание',
    statusColPrefix: 'Status',
    dateColPrefix: 'Date',
  },
};
