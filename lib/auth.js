const { Markup } = require('telegraf');
const queries = require('../db/queries');

const PHONE_BUTTON = '📱 Поделиться номером телефона';

/** The only way in: Telegram vouches for the number, the client cannot type it. */
const phoneKeyboard = () =>
  Markup.keyboard([[Markup.button.contactRequest(PHONE_BUTTON)]]).resize().oneTime();

const ASK_PHONE = [
  '👋 <b>China Cargo</b> — отслеживание грузов',
  '',
  'Чтобы войти, подтвердите свой номер телефона — нажмите кнопку ниже.',
  'Telegram отправит номер этого аккаунта, вводить вручную ничего не нужно.',
].join('\n');

const NOT_ON_LIST = [
  '🔒 <b>Доступ закрыт</b>',
  '',
  'Этого номера нет в нашей базе клиентов.',
  '',
  'Сообщите свой номер менеджеру — мы добавим его, после чего нажмите /start ещё раз.',
].join('\n');

const ACCESS_REVOKED = [
  '🔒 <b>Доступ закрыт</b>',
  '',
  'Ваш номер больше не значится в базе клиентов.',
  '',
  'Если это ошибка — свяжитесь с менеджером.',
].join('\n');

/**
 * Gate for everything except /start and the contact message itself, which
 * must stay reachable to unauthorized users — they are the way in.
 *
 * Authorization is re-checked on EVERY update rather than trusted from
 * registration time, because a manager deleting a row in the "Контакты" sheet
 * has to take effect on the client's very next message.
 */
function requireAuthorized() {
  return async (ctx, next) => {
    if (!ctx.from) return next();
    // Resolved once in bot.js: on the access list, in either role.
    if (ctx.state.account) return next();

    // Silence callback queries instead of leaving the client's tap spinning.
    if (ctx.updateType === 'callback_query') {
      await ctx.answerCbQuery('Доступ закрыт').catch(() => {});
    }

    const existing = await queries.getClient(ctx.from.id);
    const revoked = existing?.registration_state === 'REGISTERED';
    if (revoked) {
      return ctx.reply(ACCESS_REVOKED, { parse_mode: 'HTML', ...Markup.removeKeyboard() });
    }
    return ctx.reply(ASK_PHONE, { parse_mode: 'HTML', ...phoneKeyboard() });
  };
}

module.exports = { requireAuthorized, phoneKeyboard, PHONE_BUTTON, ASK_PHONE, NOT_ON_LIST, ACCESS_REVOKED };
