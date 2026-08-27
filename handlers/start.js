const { Markup } = require('telegraf');
const queries = require('../db/queries');
const { mainMenu } = require('../keyboards');
const { isManager } = require('../lib/roles');
const config = require('../config');
const logger = require('../lib/logger');
const { maskPhone } = require('../lib/phone');

const GREETING_CLIENT = [
  '👋 <b>China Cargo</b> — отслеживание грузов', '',
  'Регистрация завершена. Здесь видно, где сейчас ваш груз и когда он приедет.', '',
  '📦 <b>Мои заявки</b> — статус и путь каждого груза',
  '💬 <b>Связь с менеджером</b> — если нужна помощь',
].join('\n');

const GREETING_MANAGER = [
  '👋 <b>China Cargo</b> — панель менеджера', '',
  '📋 <b>Все заявки</b> — клиенты, их грузы и путь каждой заявки',
  '💬 <b>Связь с менеджером</b> — написать в рабочий чат', '',
  'Команда <code>/all_orders</code> — весь список текстом, одним сообщением.',
].join('\n');

const PHONE_BUTTON = '📱 Поделиться номером телефона';
const phoneKeyboard = () => Markup.keyboard([[Markup.button.contactRequest(PHONE_BUTTON)]]).resize().oneTime();

async function showRegistrationStep(ctx, client) {
  if (client?.registration_state === 'AWAITING_PHONE') {
    return ctx.reply('Нажмите кнопку ниже, чтобы передать <b>свой подтверждённый номер телефона</b>.', {
      parse_mode: 'HTML', ...phoneKeyboard(),
    });
  }
  return ctx.reply('Здравствуйте! Напишите ваше имя и фамилию.', Markup.removeKeyboard());
}

function registerStart(bot) {
  bot.start(async (ctx) => {
    await queries.upsertClient({ telegramId: ctx.from.id, firstName: ctx.from.first_name });
    if (isManager(ctx.from.id)) {
      return ctx.reply(GREETING_MANAGER, { parse_mode: 'HTML', ...mainMenu(true) });
    }
    const client = await queries.getClient(ctx.from.id);
    if (client?.registration_state === 'REGISTERED') {
      await queries.resolveClientBindings();
      return ctx.reply(GREETING_CLIENT, { parse_mode: 'HTML', ...mainMenu(false) });
    }
    return showRegistrationStep(ctx, client);
  });

  bot.use(async (ctx, next) => {
    if (ctx.from) await queries.upsertClient({ telegramId: ctx.from.id, firstName: ctx.from.first_name });
    return next();
  });

  bot.on('contact', async (ctx, next) => {
    if (isManager(ctx.from.id)) return next();
    const client = await queries.getClient(ctx.from.id);
    if (client?.registration_state !== 'AWAITING_PHONE') return next();
    if (String(ctx.message.contact.user_id) !== String(ctx.from.id)) {
      return ctx.reply('Пожалуйста, используйте кнопку и отправьте именно свой номер телефона.', phoneKeyboard());
    }
    try {
      await queries.withTransaction(async (dbClient) => {
        await queries.completeClientRegistration(ctx.from.id, ctx.message.contact.phone_number, dbClient);
        await queries.resolveClientBindings(dbClient);
      });
    } catch (error) {
      if (error.code !== 'PHONE_IN_USE') throw error;
      const extra = config.managerGroupTopicId ? { message_thread_id: config.managerGroupTopicId } : {};
      await ctx.telegram.sendMessage(
        config.managerGroupChatId,
        `⚠️ Попытка регистрации номера ${maskPhone(error.phone)} с другого Telegram ID.\nТекущий ID: ${ctx.from.id}\nСуществующий ID: ${error.ownerTelegramId}`,
        extra
      ).catch((notifyError) => logger.error('Failed to notify manager about phone conflict', notifyError));
      return ctx.reply('Этот номер уже зарегистрирован в другом аккаунте. Мы передали запрос менеджеру.', phoneKeyboard());
    }
    const orders = await queries.listOrdersForClient(ctx.from.id);
    const resultLine = orders.length > 0
      ? `\n\nНайдено заявок: <b>${orders.length}</b>.`
      : '\n\nЗаявок пока нет. Когда менеджер добавит заявку с этим номером, она появится автоматически.';
    return ctx.reply(`${GREETING_CLIENT}${resultLine}`, { parse_mode: 'HTML', ...mainMenu(false) });
  });

  bot.on('text', async (ctx, next) => {
    if (isManager(ctx.from.id)) return next();
    const client = await queries.getClient(ctx.from.id);
    if (!client || client.registration_state === 'REGISTERED') return next();
    if (client.registration_state === 'AWAITING_PHONE') {
      return ctx.reply('Для подтверждения используйте кнопку «Поделиться номером телефона».', phoneKeyboard());
    }
    const fullName = String(ctx.message.text || '').trim().replace(/\s+/g, ' ');
    if (fullName.startsWith('/')) return next();
    if (fullName.length < 2 || fullName.length > 100) {
      return ctx.reply('Введите имя и фамилию длиной от 2 до 100 символов.');
    }
    await queries.setClientName(ctx.from.id, fullName);
    return ctx.reply(`Спасибо, <b>${fullName.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</b>. Теперь подтвердите номер телефона.`, {
      parse_mode: 'HTML', ...phoneKeyboard(),
    });
  });
}

module.exports = { registerStart, GREETING_CLIENT, GREETING_MANAGER };
