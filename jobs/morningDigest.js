const config = require('../config');
const queries = require('../db/queries');
const logger = require('../lib/logger');
const { formatDateRu, formatEtaCountdown, pluralOrders, escapeHtml } = require('../lib/format');

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
    // Soonest arrival first — that's the shipment the client is waiting on.
    orders.sort((a, b) => String(a.eta_date || '9999').localeCompare(String(b.eta_date || '9999')));

    const lines = [
      '🌅 <b>Доброе утро!</b>',
      '',
      `В пути ${orders.length} ${pluralOrders(orders.length)}:`,
      '',
    ];
    for (const o of orders) {
      const cargo = o.cargo_description ? ` · ${escapeHtml(o.cargo_description)}` : '';
      lines.push(`📦 <b>${escapeHtml(o.order_number)}</b>${cargo}`);
      if (o.current_status) lines.push(`   ${escapeHtml(o.current_status)}`);
      if (o.eta_date) {
        const countdown = formatEtaCountdown(o.eta_date);
        lines.push(`   Прибытие: ${formatDateRu(o.eta_date)}${countdown ? ` · <b>${countdown}</b>` : ''}`);
      }
      lines.push('');
    }
    lines.push('Вопросы? Нажмите «💬 Связь с менеджером».');

    try {
      await telegram.sendMessage(telegramId, lines.join('\n'), { parse_mode: 'HTML' });
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
