const test = require('node:test');
const assert = require('node:assert/strict');
const format = require('../lib/format');
const { parseDecimal, formatDateRu, pluralPackages } = format;

// Thousands are grouped with a non-breaking space so a figure never wraps in
// half inside Telegram. Normalise it by character code — writing the
// character itself here would leave an invisible difference in the source.
const NBSP = String.fromCharCode(160);
const plain = (text) => text.split(NBSP).join(' ');
const formatNumberRu = (...args) => plain(format.formatNumberRu(...args));
const formatMoney = (...args) => plain(format.formatMoney(...args));

test('reads numbers as managers actually type them', () => {
  assert.equal(parseDecimal('1 250,5'), 1250.5);
  assert.equal(parseDecimal('1,250.50'), 1250.5);
  assert.equal(parseDecimal(340), 340);
  // The "3" of a unit suffix must not glue itself onto the value.
  assert.equal(parseDecimal('3,2 м³'), 3.2);
  assert.equal(parseDecimal('12 кг'), 12);
});

test('rejects cells with no number in them', () => {
  assert.equal(parseDecimal(''), null);
  assert.equal(parseDecimal('уточняется'), null);
  assert.equal(parseDecimal(null), null);
});

test('drops trailing zeros and groups thousands', () => {
  assert.equal(formatNumberRu(12.5), '12,5');
  assert.equal(formatNumberRu(12), '12');
  assert.equal(formatNumberRu(1250.5), '1 250,5');
  assert.equal(formatMoney(3750, 'USD'), '3 750 USD');
  assert.equal(formatMoney(null, 'USD'), '');
});

test('agrees plurals with the package count', () => {
  assert.equal(pluralPackages(1), 'место');
  assert.equal(pluralPackages(32), 'места');
  assert.equal(pluralPackages(47), 'мест');
  assert.equal(pluralPackages(11), 'мест');
});

test('renders an ETA on the day it names', () => {
  // A plain date string must not be shifted by the machine's timezone: this
  // is the one number clients read, and a day early is worse than useless.
  assert.equal(formatDateRu('2026-09-04'), '4 сентября');
  assert.equal(formatDateRu('2026-01-01'), '1 января');
});
