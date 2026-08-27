const MONTHS_RU = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

const MONTHS_RU_SHORT = [
  'янв', 'фев', 'мар', 'апр', 'мая', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
];

/** Formats an ISO date string ("2026-08-26") as "26 августа". Returns '' if blank/invalid. */
function formatDateRu(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  return `${d.getUTCDate()} ${MONTHS_RU[d.getUTCMonth()]}`;
}

/** Compact form for timeline rows: "26 авг". */
function formatDateShortRu(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  return `${d.getUTCDate()} ${MONTHS_RU_SHORT[d.getUTCMonth()]}`;
}

/** Formats an ISO timestamp as "26.08.2026 14:05" for logs/history shown to clients. */
function formatDateTimeRu(isoTimestamp) {
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) return isoTimestamp;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Turns an ETA into the thing clients actually want to know — how long is
 * left — rather than making them subtract dates in their head.
 * Returns '' when there's no usable date.
 */
function formatEtaCountdown(isoDate) {
  if (!isoDate) return '';
  const eta = new Date(isoDate);
  if (Number.isNaN(eta.getTime())) return '';

  const startOfDayUtc = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const now = new Date();
  const days = Math.round((startOfDayUtc(eta) - startOfDayUtc(now)) / 86400000);

  if (days === 0) return 'сегодня';
  if (days === 1) return 'завтра';
  if (days === 2) return 'послезавтра';
  if (days > 2) return `через ${days} ${pluralDays(days)}`;
  const late = Math.abs(days);
  return `задержка ${late} ${pluralDays(late)}`;
}

function pluralDays(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';
  return 'дней';
}

/** "32 места" — Russian plural agreement for the package count. */
function pluralPackages(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'место';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'места';
  return 'мест';
}

/** "3 заявки" — Russian plural agreement for the order count. */
function pluralOrders(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'заявка';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'заявки';
  return 'заявок';
}

/**
 * Escapes text that goes into a parse_mode:'HTML' message. Status text and
 * cargo names come from the spreadsheet, so a stray `<` or `&` would
 * otherwise break the whole message with a Telegram parse error.
 */
function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Numbers arrive as whatever the manager typed into the cell: "1 250,5",
 * "1,250.5", "12 кг". Everything that is not part of the number is dropped,
 * and a comma is read as the decimal separator — which is how it is written
 * here. Returns null for anything with no digits at all.
 */
function parseDecimal(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  // Take the FIRST number in the string and stop there. Stripping every
  // non-digit instead would glue the "3" of a "м3" unit onto the value.
  const match = String(raw).match(/-?\d[\d\u00a0 .,]*/);
  if (!match) return null;
  const cleaned = match[0].replace(/[\s\u00a0]/g, '').replace(/[.,]+$/, '');
  // A comma is decimal; dots that are not the last separator are thousands.
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  const normalized = lastComma > lastDot
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned.replace(/,/g, '');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Trims trailing zeros so 12.500 reads as "12,5" and 12.000 as "12". */
function formatNumberRu(value, maxDecimals = 3) {
  if (value === null || value === undefined) return '';
  const number = typeof value === 'number' ? value : parseDecimal(value);
  if (number === null) return '';
  const fixed = number.toFixed(maxDecimals).replace(/\.?0+$/, '');
  const [whole, fraction] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return fraction ? `${grouped},${fraction}` : grouped;
}

/** "1 250 USD" — the currency stays as the manager wrote it. */
function formatMoney(value, currency) {
  const amount = formatNumberRu(value, 2);
  if (!amount) return '';
  return currency ? `${amount} ${currency}` : amount;
}

/** Keeps inline-button labels within Telegram's practical width. */
function truncate(text, maxLength) {
  const s = String(text ?? '').trim();
  if (s.length <= maxLength) return s;
  return `${s.slice(0, maxLength - 1).trimEnd()}…`;
}

module.exports = {
  formatDateRu,
  formatDateShortRu,
  formatDateTimeRu,
  formatEtaCountdown,
  pluralOrders,
  pluralPackages,
  escapeHtml,
  truncate,
  parseDecimal,
  formatNumberRu,
  formatMoney,
};
