const cron = require('node-cron');
const config = require('./config');
const logger = require('./lib/logger');
const { runMorningDigest, runCatchUpDigest } = require('./jobs/morningDigest');

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

  // The bot only runs while the laptop is awake, so 09:00 is regularly
  // missed. Catch up now if today's digest hasn't gone out yet — the
  // once-a-day claim in runMorningDigest keeps restarts from re-sending.
  runCatchUpDigest(telegram).catch((err) => logger.error('Catch-up morningDigest failed', err));

  logger.info('scheduler: registered morningDigest (09:00) in', config.timezone);
}

module.exports = { registerSchedules };
