const config = require('../config');
const queries = require('../db/queries');
const logger = require('../lib/logger');
const { formatDateRu, formatEtaCountdown, pluralOrders, escapeHtml } = require('../lib/format');

// The digest is scheduled for 09:00, but the bot only runs while the laptop
// is awake and logged in — so a missed 09:00 is normal, not exceptional.
// A catch-up run on startup covers that, bounded by CATCH_UP_UNTIL_HOUR so a
// laptop opened late at night doesn't ping clients while they're asleep.
const DIGEST_HOUR = 9;
const CATCH_UP_UNTIL_HOUR = 21;

/** Current calendar date and hour in the configured timezone, not the machine's. */
function localNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}

// A digest delivered at 09:34 still says "Доброе утро", but one delivered
// after a laptop was opened in the evening shouldn't.
function greetingFor(hour) {
  if (hour < 12) return '🌅 <b>Доброе утро!</b>';
  if (hour < 17) return '☀️ <b>Добрый день!</b>';
  return '🌙 <b>Добрый вечер!</b>';
}

function buildMessage(orders, hour) {
  // Soonest arrival first — that's the shipment the client is waiting on.
  orders.sort((a, b) => String(a.eta_date || '9999').localeCompare(String(b.eta_date || '9999')));

  const lines = [greetingFor(hour), '', `В пути ${orders.length} ${pluralOrders(orders.length)}:`, ''];
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
  return lines.join('\n');
}

/**
 * Sends today's digest, at most once per calendar day. The date is claimed
 * before any message goes out, so concurrent restarts can't double-send.
 */
async function runMorningDigest(telegram, { force = false } = {}) {
  const { date, hour } = localNow();

  if (!force && !(await queries.claimDigestDate(date))) {
    logger.info('morningDigest: already sent today, skipping', date);
    return { skipped: 'already_sent', clients: 0, sent: 0 };
  }

  logger.info('morningDigest: start', date);
  const rows = await queries.listActiveOrdersWithClients();

  const byClient = new Map();
  for (const row of rows) {
    if (!byClient.has(row.telegram_id)) byClient.set(row.telegram_id, []);
    byClient.get(row.telegram_id).push(row);
  }

  let sent = 0;
  for (const [telegramId, orders] of byClient) {
    try {
      await telegram.sendMessage(telegramId, buildMessage(orders, hour), { parse_mode: 'HTML' });
      sent++;
    } catch (err) {
      logger.warn('morningDigest: send failed', telegramId, err.message);
    }
  }

  if (!force) {
    // Nothing reached anyone — release the day so a later run can retry
    // rather than marking the digest done on a total failure.
    if (byClient.size > 0 && sent === 0) {
      await queries.releaseDigestDate(date);
      logger.warn('morningDigest: no messages delivered, day released for retry', date);
    } else {
      await queries.recordDigestResult(date, byClient.size, sent);
    }
  }

  logger.info('morningDigest: done', { date, clients: byClient.size, sent });
  return { date, clients: byClient.size, sent };
}

/**
 * Called on startup: sends today's digest if 09:00 has passed, it hasn't
 * gone out yet, and it isn't too late in the day to be welcome.
 */
async function runCatchUpDigest(telegram) {
  const { date, hour } = localNow();
  if (hour < DIGEST_HOUR) return { skipped: 'before_digest_hour' };
  if (hour >= CATCH_UP_UNTIL_HOUR) {
    logger.info('morningDigest: too late to catch up, waiting for tomorrow', date, `${hour}:00`);
    return { skipped: 'too_late' };
  }
  logger.info('morningDigest: catch-up check', date, `${hour}:00`);
  return runMorningDigest(telegram);
}

module.exports = { runMorningDigest, runCatchUpDigest };

if (require.main === module) {
  const { Telegram } = require('telegraf');
  const telegram = new Telegram(config.botToken);
  // Manual runs bypass the once-a-day claim — that's the point of running it by hand.
  runMorningDigest(telegram, { force: true })
    .then((result) => {
      console.log('Digest result:', result);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
