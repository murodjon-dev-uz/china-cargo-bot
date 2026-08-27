const { Telegraf } = require('telegraf');
const config = require('./config');
const logger = require('./lib/logger');
const database = require('./db/db');
const { migrate } = require('./db/migrate');

const { registerStart } = require('./handlers/start');
const { registerMyOrders } = require('./handlers/myOrders');
const { registerContactManager } = require('./handlers/contactManager');
const { registerManagerCommands } = require('./handlers/managerCommands');
const { registerSchedules } = require('./scheduler');
const { startWebhookServer } = require('./webhook');

const bot = new Telegraf(config.botToken);
let webhookServer;
let shuttingDown = false;

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
async function main() {
  await migrate();
  await database.ping();
  await bot.launch({}, () => {
    logger.info('China Cargo bot: launched (long polling)');
    registerSchedules(bot.telegram);
    webhookServer = startWebhookServer(config.port);
  });
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Graceful shutdown', signal);
  bot.stop(signal);
  if (webhookServer) await new Promise((resolve) => webhookServer.close(resolve));
  await database.close();
  process.exit(0);
}

main().catch((err) => {
  logger.error('Application failed', err);
  process.exit(1);
});

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
