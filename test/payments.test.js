const test = require('node:test');
const assert = require('node:assert/strict');
const orderCard = require('../lib/orderCard');

// Thousands are grouped with a non-breaking space so a figure never wraps in
// half inside Telegram. Normalise it by character code — writing the
// character itself here would leave an invisible difference in the source.
const NBSP = String.fromCharCode(160);
const strip = (lines) => lines.map((line) => line.replace(/<[^>]+>/g, '').split(NBSP).join(' '));

// These cases describe the feature itself, so they switch it on explicitly
// rather than depending on whether it happens to be enabled right now.
const shown = (order) => strip(orderCard.paymentLines(order, { enabled: true }));

test('shows what is still owed after a partial payment', () => {
  assert.deepEqual(shown({ price: '3750.00', paid: '2250.00', currency: 'USD' }), [
    'Стоимость: 3 750 USD',
    'Оплачено: 2 250 USD · Осталось: 1 500 USD',
  ]);
});

test('says outright when nothing has been paid', () => {
  assert.deepEqual(shown({ price: '980.00', paid: '0', currency: 'USD' }), [
    'Стоимость: 980 USD',
    'Оплата: не поступала',
  ]);
});

test('replaces the remainder line once the order is settled', () => {
  // "Осталось: 0" reads like an unfinished sum, so it must not appear.
  assert.deepEqual(shown({ price: '1450.00', paid: '1450.00', currency: 'USD' }), [
    'Стоимость: 1 450 USD',
    'Оплачено полностью ✅',
  ]);
});

test('surfaces an overpayment instead of hiding it', () => {
  assert.deepEqual(shown({ price: '2340.00', paid: '2400.00', currency: 'USD' }), [
    'Стоимость: 2 340 USD',
    'Оплачено полностью ✅ · переплата 60 USD',
  ]);
});

test('never hides money taken against an order with no price yet', () => {
  assert.deepEqual(shown({ price: null, paid: '500', currency: 'USD' }), ['Оплачено: 500 USD']);
  assert.deepEqual(shown({ price: null, paid: '0', currency: 'USD' }), []);
});

test('does not lose fractions to floating point', () => {
  assert.deepEqual(shown({ price: '100.10', paid: '0.10', currency: 'USD' }), [
    'Стоимость: 100,1 USD',
    'Оплачено: 0,1 USD · Осталось: 100 USD',
  ]);
});

test('shows the price but no ledger lines while payments are hidden', () => {
  const hidden = (order) => strip(orderCard.paymentLines(order, { enabled: false }));
  // The price is cargo information in its own right, so it survives the flag.
  assert.deepEqual(hidden({ price: '3750.00', paid: '2250.00', currency: 'USD' }), ['Стоимость: 3 750 USD']);
  assert.deepEqual(hidden({ price: null, paid: '500', currency: 'USD' }), []);
});
