// Maps free-form manager text to a canonical status code.
//
// The text written by the manager is exactly what the client reads, so it
// stays human-friendly. The status code is derived from it so the bot's
// logic (final-state detection, digest filtering, emoji, history grouping)
// keeps working without forcing the manager to pick from a dropdown.
//
// Explicit codes (e.g. "AT_BORDER") written anywhere in the text are honored
// first — handy for power users and for programmatic writes.

const RULES = [
  {
    code: 'DELIVERED',
    weight: 10,
    patterns: ['доставлен', 'вручен', 'вручён', 'выдан клиенту', 'получен клиентом', 'завершен', 'завершён', 'delivered'],
  },
  {
    code: 'CUSTOMS',
    weight: 5,
    patterns: ['таможн', 'растамож', 'customs', 'декларац'],
  },
  {
    code: 'AT_BORDER',
    weight: 4,
    patterns: ['границ', 'кпп', 'погран', 'border'],
  },
  {
    code: 'AT_WAREHOUSE_CN',
    weight: 3,
    patterns: ['склад', 'кита', 'warehouse', 'упаков', 'готов к отправке', 'принят на склад'],
  },
  {
    code: 'IN_TRANSIT',
    weight: 2,
    patterns: ['в пути', 'в дороге', 'едет', 'транзит', 'перевоз', 'отправлен', 'транспортиров'],
  },
];

const CODE_PATTERN = /\b(AT_WAREHOUSE_CN|IN_TRANSIT|AT_BORDER|CUSTOMS|DELIVERED)\b/i;

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Returns a canonical status code for the given text, or null when the text
 * cannot be mapped confidently (manager should review the row).
 */
function inferStatusCode(text) {
  const normalized = normalize(text);
  if (!normalized) return null;

  const explicit = normalized.match(CODE_PATTERN);
  if (explicit) return explicit[1].toUpperCase();

  let bestCode = null;
  let bestScore = 0;
  for (const rule of RULES) {
    let score = 0;
    for (const pattern of rule.patterns) {
      if (normalized.includes(pattern)) score += rule.weight;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCode = rule.code;
    }
  }
  return bestCode;
}

module.exports = { inferStatusCode };
