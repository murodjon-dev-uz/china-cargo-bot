const test = require('node:test');
const assert = require('node:assert/strict');

// Authorization lives in SQL — a JOIN between clients and the mirrored access
// list — so testing it without a database would only test a mock. Every case
// runs inside a transaction that is rolled back, so the dev data survives.
const { pool } = require('../db/db');
const queries = require('../db/queries');
const { migrate } = require('../db/migrate');

const ALLOWED = '+998901112233';
const STRANGER = '+998907776655';
const TELEGRAM_ID = 999000111;

// Resolved once, lazily: node:test evaluates a test's options when the test
// is DEFINED, so a flag set in a before() hook would still be false by then
// and every case would skip. The check has to happen inside the test body.
let ready;
function databaseReady() {
  if (!ready) ready = migrate().then(() => true, () => false);
  return ready;
}

test.after(async () => { await pool.end().catch(() => {}); });

/** Runs fn against a client whose work is always rolled back. */
async function inRollback(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

const dbTest = (name, fn) => test(name, async (t) => {
  if (!(await databaseReady())) return t.skip('no database reachable');
  return inRollback(fn);
});

dbTest('a phone on the access list authorizes its owner', async (db) => {
  await queries.replaceContacts([{ phone: ALLOWED, fullName: 'Алишер', sheetRow: 2 }], 'client', db);
  await queries.upsertClient({ telegramId: TELEGRAM_ID, firstName: 'A' }, db);

  const result = await queries.completeClientRegistration(TELEGRAM_ID, ALLOWED, db);
  assert.equal(result.phone, ALLOWED);

  const authorized = await queries.getAuthorizedClient(TELEGRAM_ID, db);
  assert.ok(authorized, 'client should be authorized');
  // The name comes from the sheet, never from something the client typed.
  assert.equal(authorized.full_name, 'Алишер');
});

dbTest('a phone missing from the access list is refused', async (db) => {
  await queries.replaceContacts([{ phone: ALLOWED, fullName: 'Алишер', sheetRow: 2 }], 'client', db);
  await queries.upsertClient({ telegramId: TELEGRAM_ID, firstName: 'A' }, db);

  await assert.rejects(
    () => queries.completeClientRegistration(TELEGRAM_ID, STRANGER, db),
    (error) => error.code === 'NOT_ALLOWED'
  );
  assert.equal(await queries.getAuthorizedClient(TELEGRAM_ID, db), null);
});

dbTest('removing the number from the sheet revokes an existing login', async (db) => {
  await queries.replaceContacts([{ phone: ALLOWED, fullName: 'Алишер', sheetRow: 2 }], 'client', db);
  await queries.upsertClient({ telegramId: TELEGRAM_ID, firstName: 'A' }, db);
  await queries.completeClientRegistration(TELEGRAM_ID, ALLOWED, db);
  assert.ok(await queries.getAuthorizedClient(TELEGRAM_ID, db));

  // The manager deletes the row: the next sync sends a list without it.
  const result = await queries.replaceContacts([{ phone: STRANGER, fullName: 'Кто-то', sheetRow: 2 }], 'client', db);
  assert.equal(result.removed, 1);
  assert.equal(await queries.getAuthorizedClient(TELEGRAM_ID, db), null);
});

dbTest('the "Менеджеры" list makes its number a manager', async (db) => {
  await queries.replaceContacts([{ phone: ALLOWED, fullName: 'Мурод', sheetRow: 2 }], 'manager', db);
  await queries.upsertClient({ telegramId: TELEGRAM_ID, firstName: 'M' }, db);

  const result = await queries.completeClientRegistration(TELEGRAM_ID, ALLOWED, db);
  assert.equal(result.contact.role, 'manager');
  assert.equal((await queries.getAuthorizedClient(TELEGRAM_ID, db)).role, 'manager');
});

dbTest('syncing one list never revokes the other role', async (db) => {
  await queries.replaceContacts([{ phone: ALLOWED, fullName: 'Мурод', sheetRow: 2 }], 'manager', db);
  await queries.replaceContacts([{ phone: STRANGER, fullName: 'Клиент', sheetRow: 2 }], 'client', db);

  // Clearing the client tab must leave the manager standing.
  const result = await queries.replaceContacts([], 'client', db);
  assert.equal(result.removed, 1);
  assert.ok(await queries.findContact(ALLOWED, db), 'manager should survive a client-list sync');
});

dbTest('the access list is matched on the normalized number, not the raw text', async (db) => {
  // The manager types the number by hand, so it arrives in whatever shape.
  await queries.replaceContacts([{ phone: '90 111-22-33', fullName: 'Алишер', sheetRow: 2 }], 'client', db);
  await queries.upsertClient({ telegramId: TELEGRAM_ID, firstName: 'A' }, db);

  // Telegram delivers it without a plus, digits only.
  const result = await queries.completeClientRegistration(TELEGRAM_ID, '998901112233', db);
  assert.equal(result.phone, ALLOWED);
  assert.ok(await queries.getAuthorizedClient(TELEGRAM_ID, db));
});
