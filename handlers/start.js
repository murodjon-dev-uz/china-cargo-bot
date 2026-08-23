const queries = require('../db/queries');
const { mainMenu } = require('../keyboards');

const GREETING =
  'Здравствуйте! Это логистика China Cargo. Нажмите кнопку "Мои заявки", чтобы увидеть свои грузы, ' +
  'или "Связь с менеджером", если нужна помощь.';

function registerStart(bot) {
  bot.start((ctx) => {
    queries.upsertClient({
      telegramId: ctx.from.id,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
    });
    queries.resolveClientBindings();
    return ctx.reply(GREETING, mainMenu());
  });

  // Keep the client record fresh (username can change) on every message, not just /start.
  bot.use((ctx, next) => {
    if (ctx.from) {
      queries.upsertClient({
        telegramId: ctx.from.id,
        username: ctx.from.username,
        firstName: ctx.from.first_name,
      });
    }
    return next();
  });
}

module.exports = { registerStart, GREETING };
