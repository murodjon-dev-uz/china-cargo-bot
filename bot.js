const { Telegraf } = require('telegraf');
const config = require('./config');
const logger = require('./lib/logger');
require('./db/db'); // initializes schema + seed data on first run

const { registerStart } = require('./handlers/start');
const { registerMyOrders } = require('./handlers/myOrders');
const { registerContactManager } = require('./handlers/contactManager');
const { registerManagerCommands } = require('./handlers/managerCommands');
const { registerSchedules } = require('./scheduler');
const { startWebhookServer } = require('./webhook');

const bot = new Telegraf(config.botToken);

// Registration order matters: button-text handlers must come before the
// generic manager text-catcher in managerCommands.js, so a manager tapping
// "Мои заявки"/"Связь с менеджером" is handled by those, not swallowed as a
// pending status-comment reply.
registerStart(bot);
registerMyOrders(bot);
registerContactManager(bot);
registerManagerCommands(bot);

process.on('uncaughtException', (err) => logger.error('uncaughtException', err));
process.on('unhandledRejection', (err) => logger.error('unhandledRejection', err));

// IMPORTANT: bot.launch()'s returned promise does NOT resolve on successful
// startup for long polling — it only resolves after bot.stop() is called
// (it awaits the polling loop itself, which runs until shutdown). The second
// argument is telegraf's dedicated "authenticated, about to start polling"
// callback — that's the correct place to register schedules, not `.then()`.
bot
  .launch({}, () => {
    logger.info('China Cargo bot: launched (long polling)');
    registerSchedules(bot.telegram);
    startWebhookServer(3000);
  })
  .catch((err) => {
    logger.error('Bot stopped with an error', err);
    process.exit(1);
  });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
