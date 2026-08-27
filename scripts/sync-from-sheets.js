const config = require('../config');
const sheets = require('../sheets');
const queries = require('../db/queries');
const database = require('../db/db');
const { migrate } = require('../db/migrate');

// Column letters on the "Контакты" tab: A "Имя клиента", B "Номер телефона"
// are the manager's, C and D are the two the sync layer fills in.
const CONTACT_STATUS_COLUMN = 'C';
const CONTACT_JOINED_COLUMN = 'D';

function statusesFromRow(row) {
  const statuses = [];
  for (let index = 1; index <= 100; index++) {
    const text = row[`Status ${index}`];
    const date = row[`Date ${index}`];
    if (text) statuses.push({ text, date: date || null });
    if (!Object.hasOwn(row, `Status ${index + 1}`)) break;
  }
  return statuses;
}

/**
 * Pushes "вошёл / не вошёл" and the login date back into the access-list tab,
 * so the manager can see at a glance who still needs the bot's link. This
 * lives in the sync layer on purpose: the bot process itself never talks to
 * Google, it only ever reads the mirrored table in Postgres.
 */
async function writeBackLoginStatus() {
  const rows = await queries.listContactsForWriteback();
  for (const row of rows) {
    const joined = row.registration_completed_at
      ? new Date(row.registration_completed_at).toISOString().slice(0, 10)
      : '';
    await sheets.writeCell(config.sheets.contactsTab, row.sheet_row, CONTACT_STATUS_COLUMN, row.telegram_id ? 'Вошёл' : '');
    await sheets.writeCell(config.sheets.contactsTab, row.sheet_row, CONTACT_JOINED_COLUMN, joined);
  }
  return rows.length;
}

async function main() {
  await migrate();

  // The access list goes first: an order row is useless to a client who
  // cannot log in, and a number added in this run should work immediately.
  const contactRows = await sheets.readTab(config.sheets.contactsTab);
  const contacts = await queries.withTransaction((client) => queries.replaceContacts(
    contactRows.map((row) => ({
      fullName: row[config.sheets.contactNameCol] || null,
      phone: row[config.sheets.contactPhoneCol] || null,
      sheetRow: row._row,
    })),
    client
  ));

  const orderRows = await sheets.readTab(config.sheets.ordersTab);
  const trackingRows = await sheets.readTab(config.sheets.trackingTab);

  await queries.withTransaction(async (client) => {
    for (const row of orderRows) {
      const orderNumber = row[config.sheets.orderNumberCol];
      if (!orderNumber) continue;
      await queries.upsertOrderMasterData({
        orderNumber,
        cargoDescription: row[config.sheets.cargoCol] || null,
        route: row[config.sheets.routeCol] || null,
        etaDate: row[config.sheets.etaCol] || null,
        clientName: row[config.sheets.clientCol] || null,
        boundPhone: row[config.sheets.phoneCol] || null,
        stage: row['Этап'] || null,
      }, client);
    }
  });

  let histories = 0;
  await queries.withTransaction(async (client) => {
    for (const row of trackingRows) {
      const orderNumber = row[config.sheets.orderNumberCol];
      if (!orderNumber || !(await queries.findOrder(orderNumber, client))) continue;
      const statuses = statusesFromRow(row);
      await queries.replaceSheetStatusHistory(orderNumber, statuses, client);
      histories += statuses.length;
    }
  });

  const writtenBack = await writeBackLoginStatus();

  console.log(JSON.stringify({
    contacts: contacts.kept, revoked: contacts.removed, writtenBack,
    orders: orderRows.length, trackingRows: trackingRows.length, histories,
  }));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => database.close());
