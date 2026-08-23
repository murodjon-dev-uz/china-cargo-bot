const config = require('../config');
const queries = require('../db/queries');
const logger = require('../lib/logger');
const { formatDateRu } = require('../lib/format');

async function runMorningDigest(telegram) {
  logger.info('morningDigest: start');
  const rows = queries.listActiveOrdersWithClients();

  const byClient = new Map();
  for (const row of rows) {
    if (!byClient.has(row.telegram_id)) byClient.set(row.telegram_id, []);
    byClient.get(row.telegram_id).push(row);
  }

  let sent = 0;
  for (const [telegramId, orders] of byClient) {
    const lines = ['🌅 Доброе утро! Ваши грузы на сегодня:'];
    for (const o of orders) {
      const parts = [`• ${o.order_number}`];
      if (o.cargo_description) parts.push(`— ${o.cargo_description}`);
      if (o.current_status) parts.push(`, сейчас: ${o.current_status}`);
      if (o.eta_date) parts.push(`, прогноз ${formatDateRu(o.eta_date)}`);
      lines.push(parts.join(''));
    }
    lines.push('Если есть вопросы, нажмите «Связь с менеджером».');

    try {
      await telegram.sendMessage(telegramId, lines.join('\n'));
      sent++;
    } catch (err) {
      logger.warn('morningDigest: send failed', telegramId, err.message);
    }
  }

  logger.info('morningDigest: done', { clients: byClient.size, sent });
  return { clients: byClient.size, sent };
}

module.exports = { runMorningDigest };

if (require.main === module) {
  const { Telegram } = require('telegraf');
  const telegram = new Telegram(config.botToken);
  runMorningDigest(telegram)
    .then((result) => {
      console.log('Digest result:', result);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
