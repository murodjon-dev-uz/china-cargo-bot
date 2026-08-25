const queries = require('../db/queries');
const { mainMenu } = require('../keyboards');
const { isManager } = require('../lib/roles');

// Leads with what the client came for (where is my cargo), then names each
// button and what it does — so the first screen doubles as the instructions.
const GREETING_CLIENT = [
  '👋 <b>China Cargo</b> — отслеживание грузов',
  '',
  'Здесь видно, где сейчас ваш груз и когда он приедет.',
  '',
  '📦 <b>Мои заявки</b> — статус и путь каждого груза',
  '💬 <b>Связь с менеджером</b> — если нужна помощь',
].join('\n');

const GREETING_MANAGER = [
  '👋 <b>China Cargo</b> — панель менеджера',
  '',
  '📋 <b>Все заявки</b> — клиенты, их грузы и путь каждой заявки',
  '💬 <b>Связь с менеджером</b> — написать в рабочий чат',
  '',
  'Команда <code>/all_orders</code> — весь список текстом, одним сообщением.',
].join('\n');

function registerStart(bot) {
  bot.start((ctx) => {
    queries.upsertClient({
      telegramId: ctx.from.id,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
    });
    queries.resolveClientBindings();

    const manager = isManager(ctx.from.id);
    return ctx.reply(manager ? GREETING_MANAGER : GREETING_CLIENT, {
      parse_mode: 'HTML',
      ...mainMenu(manager),
    });
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

module.exports = { registerStart, GREETING_CLIENT, GREETING_MANAGER };
