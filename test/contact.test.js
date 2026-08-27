const test = require('node:test');
const assert = require('node:assert/strict');
const { requesterLines } = require('../handlers/contactManager');

const asManager = {
  from: { id: 6578187588, first_name: 'Murodjon' },
  state: { account: { role: 'manager', full_name: 'Murodjon', phone: '+998979226843' } },
};
const asClient = {
  from: { id: 11122233, first_name: 'Ali' },
  state: { account: { role: 'client', full_name: 'Алишер Каримов', phone: '+998901112233' } },
};

test('names the role so a manager knows who is writing', () => {
  assert.match(requesterLines(asManager)[0], /менеджер$/);
  assert.match(requesterLines(asClient)[0], /клиент$/);
});

test('carries the name, phone and Telegram id', () => {
  const lines = requesterLines(asClient);
  assert.match(lines[0], /Алишер Каримов/);
  assert.match(lines[1], /\+998901112233/);
  assert.match(lines[2], /11122233/);
});

test('links the name to the private chat', () => {
  // So a manager can answer straight from the group instead of searching.
  assert.match(requesterLines(asClient)[0], /tg:\/\/user\?id=11122233/);
});

test('says so plainly when there is no confirmed number', () => {
  const lines = requesterLines({ from: { id: 999, first_name: 'Гость' }, state: {} });
  assert.equal(lines[1], '📱 номер не подтверждён');
});

test('falls back to the Telegram first name when the sheet has none', () => {
  const lines = requesterLines({ from: { id: 5, first_name: 'Гость' }, state: { account: { role: 'client' } } });
  assert.match(lines[0], /Гость/);
});
