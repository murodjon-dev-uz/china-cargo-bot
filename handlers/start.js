const { Markup } = require('telegraf');
const queries = require('../db/queries');
const { mainMenu } = require('../keyboards');
const { isManager } = require('../lib/roles');
const { phoneKeyboard, ASK_PHONE, NOT_ON_LIST } = require('../lib/auth');
const { escapeHtml } = require('../lib/format');
const config = require('../config');
const logger = require('../lib/logger');
const { maskPhone } = require('../lib/phone');

const GREETING_CLIENT = [
  '👋 <b>China Cargo</b> — отслеживание грузов', '',
  'Здесь видно, где сейчас ваш груз и когда он приедет.', '',
  '📦 <b>Мои заявки</b> — статус и путь каждого груза',
  '💬 <b>Связь с менеджером</b> — если нужна помощь',
].join('\n');

const GREETING_MANAGER = [
  '👋 <b>China Cargo</b> — панель менеджера', '',
  '📋 <b>Все заявки</b> — клиенты, их грузы и путь каждой заявки',
  '💬 <b>Связь с менеджером</b> — написать в рабочий чат', '',
  'Команда <code>/all_orders</code> — весь список текстом, одним сообщением.',
].join('\n');

function registerStart(bot) {
  bot.start(async (ctx) => {
    if (isManager(ctx.from.id)) {
      return ctx.reply(GREETING_MANAGER, { parse_mode: 'HTML', ...mainMenu(true) });
    }
    const client = await queries.getAuthorizedClient(ctx.from.id);
    if (client) {
      await queries.resolveClientBindings();
      return ctx.reply(GREETING_CLIENT, { parse_mode: 'HTML', ...mainMenu(false) });
    }
    return ctx.reply(ASK_PHONE, { parse_mode: 'HTML', ...phoneKeyboard() });
  });

  bot.on('contact', async (ctx, next) => {
    if (isManager(ctx.from.id)) return next();

    // A contact card can be forwarded from anyone; only the one Telegram
    // itself attaches to the sender carries a user_id equal to theirs. This
    // is the whole reason the number is trustworthy at all.
    if (String(ctx.message.contact.user_id) !== String(ctx.from.id)) {
      return ctx.reply('Отправьте, пожалуйста, <b>свой</b> номер — нажмите кнопку ниже.', {
        parse_mode: 'HTML', ...phoneKeyboard(),
      });
    }

    let registration;
    try {
      registration = await queries.withTransaction(async (dbClient) => {
        const result = await queries.completeClientRegistration(ctx.from.id, ctx.message.contact.phone_number, dbClient);
        await queries.resolveClientBindings(dbClient);
        return result;
      });
    } catch (error) {
      if (error.code === 'NOT_ALLOWED') {
        logger.info('registration refused: phone not on access list', maskPhone(error.phone), ctx.from.id);
        return ctx.reply(NOT_ON_LIST, { parse_mode: 'HTML', ...Markup.removeKeyboard() });
      }
      if (error.code !== 'PHONE_IN_USE') throw error;
      const extra = config.managerGroupTopicId ? { message_thread_id: config.managerGroupTopicId } : {};
      await ctx.telegram.sendMessage(
        config.managerGroupChatId,
        `⚠️ Попытка входа с номером ${maskPhone(error.phone)} из другого Telegram-аккаунта.\nТекущий ID: ${ctx.from.id}\nСуществующий ID: ${error.ownerTelegramId}`,
        extra
      ).catch((notifyError) => logger.error('Failed to notify manager about phone conflict', notifyError));
      return ctx.reply('Этот номер уже привязан к другому аккаунту Telegram. Мы передали запрос менеджеру.', Markup.removeKeyboard());
    }

    const name = registration.contact.full_name;
    const hello = name ? `Здравствуйте, <b>${escapeHtml(name)}</b>!\n\n` : '';
    const orders = await queries.listOrdersForClient(ctx.from.id);
    const resultLine = orders.length > 0
      ? `\n\nНайдено заявок: <b>${orders.length}</b>.`
      : '\n\nЗаявок пока нет. Когда менеджер добавит заявку с этим номером, она появится автоматически.';
    return ctx.reply(`${hello}${GREETING_CLIENT}${resultLine}`, { parse_mode: 'HTML', ...mainMenu(false) });
  });
}

module.exports = { registerStart, GREETING_CLIENT, GREETING_MANAGER };
