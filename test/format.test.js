const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml, formatDateRu, pluralOrders } = require('../lib/format');

test('escapes Telegram HTML input', () => {
  assert.equal(escapeHtml('<cargo & status>'), '&lt;cargo &amp; status&gt;');
});

test('formats ISO dates in Russian', () => {
  assert.equal(formatDateRu('2026-08-27'), '27 августа');
});

test('uses correct Russian order plurals', () => {
  assert.equal(pluralOrders(1), 'заявка');
  assert.equal(pluralOrders(3), 'заявки');
  assert.equal(pluralOrders(11), 'заявок');
});
