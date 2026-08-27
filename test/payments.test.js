const test = require('node:test');
const assert = require('node:assert/strict');
const { paymentLines } = require('../lib/orderCard');

// Thousands are grouped with a non-breaking space so the number never wraps
// mid-figure in Telegram. Normalise it here so the expectations below stay
// readable instead of carrying an invisible character.
const NBSP = String.fromCharCode(160);

// Thousands are grouped with a non-breaking space so a figure never wraps in
// half inside Telegram. Normalise it by character code so the expectations
// below carry no invisible characters.
const strip = (order) => paymentLines(order)
  .map((line) => line.replace(/<[^>]+>/g, '').split(NBSP).join(' '));

test('shows what is still owed after a partial payment', () => {
  assert.deepEqual(strip({ price: '3750.00', paid: '2250.00', currency: 'USD' }), [
    'Стоимость: 3 750 USD',
    'Оплачено: 2 250 USD · Осталось: 1 500 USD',
  ]);
});

test('says outright when nothing has been paid', () => {
  assert.deepEqual(strip({ price: '980.00', paid: '0', currency: 'USD' }), [
    'Стоимость: 980 USD',
    'Оплата: не поступала',
  ]);
});

test('replaces the remainder line once the order is settled', () => {
  // "Осталось: 0" reads like an unfinished sum, so it must not appear.
  assert.deepEqual(strip({ price: '1450.00', paid: '1450.00', currency: 'USD' }), [
    'Стоимость: 1 450 USD',
    'Оплачено полностью ✅',
  ]);
});

test('surfaces an overpayment instead of hiding it', () => {
  assert.deepEqual(strip({ price: '2340.00', paid: '2400.00', currency: 'USD' }), [
    'Стоимость: 2 340 USD',
    'Оплачено полностью ✅ · переплата 60 USD',
  ]);
});

test('never hides money taken against an order with no price yet', () => {
  assert.deepEqual(strip({ price: null, paid: '500', currency: 'USD' }), ['Оплачено: 500 USD']);
  assert.deepEqual(strip({ price: null, paid: '0', currency: 'USD' }), []);
});

test('does not lose fractions to floating point', () => {
  assert.deepEqual(strip({ price: '100.10', paid: '0.10', currency: 'USD' }), [
    'Стоимость: 100,1 USD',
    'Оплачено: 0,1 USD · Осталось: 100 USD',
  ]);
});
