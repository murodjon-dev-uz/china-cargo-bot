const cron = require('node-cron');
const config = require('./config');
const logger = require('./lib/logger');
const { runMorningDigest } = require('./jobs/morningDigest');

function registerSchedules(telegram) {
  // Webhook now handles real-time sync, so nightlySync is disabled
  // Status updates from Google Sheets flow through: Apps Script → webhook → bot.js → DB

  // 09:00 Asia/Tashkent — daily digest for clients with active orders.
  cron.schedule(
    '0 9 * * *',
    () => {
      runMorningDigest(telegram).catch((err) => logger.error('Scheduled morningDigest failed', err));
    },
    { timezone: config.timezone }
  );

  logger.info('scheduler: registered morningDigest (09:00) in', config.timezone);
}

module.exports = { registerSchedules };
