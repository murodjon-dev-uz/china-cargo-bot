const cron = require('node-cron');
const config = require('./config');
const logger = require('./lib/logger');
const { runNightlySync } = require('./jobs/nightlySync');
const { runMorningDigest } = require('./jobs/morningDigest');

function registerSchedules(telegram) {
  // 02:30 Asia/Tashkent — read the sheet, apply status changes, notify clients.
  cron.schedule(
    '30 2 * * *',
    () => {
      runNightlySync(telegram).catch((err) => logger.error('Scheduled nightlySync failed', err));
    },
    { timezone: config.timezone }
  );

  // 09:00 Asia/Tashkent — daily digest for clients with active orders.
  cron.schedule(
    '0 9 * * *',
    () => {
      runMorningDigest(telegram).catch((err) => logger.error('Scheduled morningDigest failed', err));
    },
    { timezone: config.timezone }
  );

  logger.info('scheduler: registered nightlySync (02:30) and morningDigest (09:00) in', config.timezone);
}

module.exports = { registerSchedules };
