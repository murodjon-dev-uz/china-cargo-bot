const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhone, maskPhone } = require('../lib/phone');

test('normalizes Uzbekistan phone formats', () => {
  assert.equal(normalizePhone('90 123-45-67'), '+998901234567');
  assert.equal(normalizePhone('998901234567'), '+998901234567');
  assert.equal(normalizePhone('+998 90 123 45 67'), '+998901234567');
});

test('rejects unusable phone values', () => {
  assert.equal(normalizePhone('123'), null);
  assert.equal(normalizePhone(''), null);
});

test('masks phone for manager-facing output', () => {
  assert.equal(maskPhone('+998901234567'), '+998901 *** ** 67');
});
