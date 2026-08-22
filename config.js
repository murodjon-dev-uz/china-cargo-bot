require('dotenv').config();
const path = require('node:path');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required .env variable: ${name}`);
  return value;
}

function requiredIdList(name) {
  const ids = required(name)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const num = Number(s);
      if (isNaN(num)) throw new Error(`Invalid ID in ${name}: "${s}" is not a number`);
      return num;
    });
  return ids;
}

module.exports = {
  botToken: required('BOT_TOKEN'),
  managerGroupChatId: Number(required('MANAGER_GROUP_CHAT_ID')),
  managerTelegramIds: requiredIdList('MANAGER_TELEGRAM_IDS'),
  spreadsheetId: required('SPREADSHEET_ID'),
  googleServiceAccountKeyPath: path.resolve(required('GOOGLE_SERVICE_ACCOUNT_KEY_PATH')),
  dbPath: path.join(__dirname, 'data', 'cargo.db'),
  timezone: 'Asia/Tashkent',
  sheets: {
    ordersTab: 'Заявки',
    statusesTab: 'Статусы для бота',
    orderNumberCol: 'Номер заявки',
    clientCol: 'Клиент',
    cargoCol: 'Описание груза',
    routeCol: 'Маршрут',
    etaCol: 'ETA',
    statusMessageCol: 'Сообщение клиенту',
  },
};
