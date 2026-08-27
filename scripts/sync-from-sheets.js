const config = require('../config');
const sheets = require('../sheets');
const queries = require('../db/queries');
const database = require('../db/db');
const { migrate } = require('../db/migrate');

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

async function main() {
  await migrate();
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

  console.log(JSON.stringify({ orders: orderRows.length, trackingRows: trackingRows.length, histories }));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => database.close());
