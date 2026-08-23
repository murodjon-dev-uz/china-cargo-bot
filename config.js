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
  // Optional: forum-topic thread ID within the manager group (from a
  // t.me/c/<group>/<topic_id> link). Omit to post to the group's general
  // stream instead of a specific topic.
  managerGroupTopicId: process.env.MANAGER_GROUP_TOPIC_ID
    ? Number(process.env.MANAGER_GROUP_TOPIC_ID)
    : null,
  managerTelegramIds: requiredIdList('MANAGER_TELEGRAM_IDS'),
  spreadsheetId: required('SPREADSHEET_ID'),
  googleServiceAccountKeyPath: path.resolve(required('GOOGLE_SERVICE_ACCOUNT_KEY_PATH')),
  webhookSecret: required('WEBHOOK_SECRET'),
  dbPath: path.join(__dirname, 'data', 'cargo.db'),
  timezone: 'Asia/Tashkent',
  sheets: {
    ordersTab: 'Заявки',
    trackingTab: 'Трекинг',
    orderNumberCol: 'Cargo ID',
    clientCol: 'Client',
    cargoCol: 'Cargo',
    routeCol: 'Route',
    etaCol: 'ETA',
    statusColPrefix: 'Status',
    dateColPrefix: 'Date',
  },
};
