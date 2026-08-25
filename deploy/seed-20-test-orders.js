// One-off: seeds CRG-0001..CRG-0020 into "Заявки" + "Трекинг" (Google Sheets
// is the entry point — the DB is populated by calling the same webhook
// endpoints Apps Script uses, exercising the real sync path, not a direct
// DB write). Every order gets at least 5 status entries in its history.
require('dotenv').config();
const { google } = require('googleapis');
const http = require('node:http');
const config = require('../config');

const CLIENTS = ['defeendeeer', 'aziz_trade', 'nodira_shop', 'sardor_import', 'kamola_biz'];
const ROUTES = [
  ['Шанхай', 'Запчасти для станков'],
  ['Гуанчжоу', 'Электроника'],
  ['Шэньчжэнь', 'Аксессуары для телефонов'],
  ['Пекин', 'Текстиль'],
  ['Иу', 'Хозтовары'],
];

// Full 8-step lifecycle. Every order gets a prefix of this (length 5-8), so
// every order has at least 5 history entries, with varied progress.
const PIPELINE = [
  { text: '🏭 Заказ принят, груз комплектуется на складе', stage: 'AT_FACTORY' },
  { text: '📦 Груз упакован и готов к отправке', stage: 'AT_FACTORY' },
  { text: '🚛 Груз отправлен со склада в Китае', stage: 'IN_TRANSIT' },
  { text: '✈️ Груз загружен на рейс, вылет состоялся', stage: 'IN_TRANSIT' },
  { text: '🛬 Груз прибыл в аэропорт Ташкента', stage: 'IN_TRANSIT' },
  { text: '🛂 Груз проходит таможенное оформление', stage: 'IN_TRANSIT' },
  { text: '🚚 Таможня пройдена, груз выехал на склад в Ташкенте', stage: 'IN_TRANSIT' },
  { text: '✅ Заказ доставлен, посылка получена клиентом', stage: 'DELIVERED' },
];
const STAGE_VALUES = { AT_FACTORY: '🏭 На заводе', IN_TRANSIT: '🚚 В пути', DELIVERED: '✅ Доставлен' };
// Cycle through lengths 5,6,7,8 so every order has >=5 entries with varied depth.
const LENGTHS = [5, 6, 7, 8];

function pad(n) {
  return String(n).padStart(4, '0');
}

function addDays(base, days) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

const TODAY = '2026-08-24';

const orders = Array.from({ length: 20 }, (_, i) => {
  const n = i + 1;
  const cargoId = `CRG-${pad(n)}`;
  const client = CLIENTS[i % CLIENTS.length];
  const [city, cargo] = ROUTES[i % ROUTES.length];
  const length = LENGTHS[i % LENGTHS.length];
  const steps = PIPELINE.slice(0, length);
  const stage = steps[steps.length - 1].stage;
  const eta = addDays(TODAY, 3 + (n % 10));
  // Each step lands one day apart, most recent step ending at TODAY-1 (or
  // TODAY for a delivered order), oldest step (length-1) days before that.
  const statuses = steps.map((s, idx) => ({
    text: s.text,
    date: addDays(TODAY, idx - (length - 1)),
  }));
  return { cargoId, client, cargo: `${cargo} (партия ${n})`, route: `${city} → Ташкент`, eta, stage, statuses };
});

function postJsonHttp(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      { hostname: 'localhost', port: 3000, path, method: 'POST', headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': config.webhookSecret,
        'Content-Length': Buffer.byteLength(payload),
      } },
      (res) => {
        let data = '';
        res.on('data', (d) => (data += d));
        res.on('end', () => resolve(JSON.parse(data)));
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  const auth = new google.auth.GoogleAuth({
    keyFile: config.googleServiceAccountKeyPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  // Safety: refuse to run if either sheet already has data rows, to avoid
  // repeating the earlier ID-collision incident.
  const [existingOrders, existingTracking] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: config.spreadsheetId, range: 'Заявки!A2:A2' }),
    sheets.spreadsheets.values.get({ spreadsheetId: config.spreadsheetId, range: 'Трекинг!A2:A2' }),
  ]);
  if ((existingOrders.data.values || []).length > 0 || (existingTracking.data.values || []).length > 0) {
    console.error('Refusing to seed: "Заявки" or "Трекинг" already has data rows. Clear them first.');
    process.exit(1);
  }

  console.log('1/3: Writing to "Заявки"...');
  const ordersRows = orders.map((o) => [o.cargoId, o.client, o.cargo, o.route, o.eta, STAGE_VALUES[o.stage]]);
  await sheets.spreadsheets.values.append({
    spreadsheetId: config.spreadsheetId,
    range: 'Заявки!A1',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: ordersRows },
  });

  console.log('2/3: Writing to "Трекинг"...');
  const trackingRows = orders.map((o) => o.statuses.flatMap((s) => [s.text, s.date]));
  const maxLen = Math.max(...trackingRows.map((r) => r.length));
  const paddedRows = trackingRows.map((r, i) => [orders[i].cargoId, ...r, ...Array(maxLen - r.length).fill('')]);
  await sheets.spreadsheets.values.append({
    spreadsheetId: config.spreadsheetId,
    range: 'Трекинг!A1',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: paddedRows },
  });

  console.log('3/3: Syncing DB via webhook endpoints (Sheets -> DB, real sync path)...');
  const orderSyncRows = orders.map((o) => ({
    cargoId: o.cargoId, client: o.client, cargo: o.cargo, route: o.route, eta: o.eta, stage: STAGE_VALUES[o.stage],
  }));
  const orderResult = await postJsonHttp('/webhook/order-sync', { rows: orderSyncRows });
  const orderFails = orderResult.results.filter((r) => !r.ok);
  console.log(`order-sync: ${orderResult.results.length - orderFails.length}/${orderResult.results.length} ok`, orderFails);

  const trackingSyncRows = orders.map((o) => ({ cargoId: o.cargoId, statuses: o.statuses }));
  const trackingResult = await postJsonHttp('/webhook/tracking-sync', { rows: trackingSyncRows });
  const trackingFails = trackingResult.results.filter((r) => !r.ok);
  console.log(`tracking-sync: ${trackingResult.results.length - trackingFails.length}/${trackingResult.results.length} ok`, trackingFails);

  console.log('\n✅ Done. 20 test orders CRG-0001..CRG-0020 seeded via Google Sheets, each with 5-8 status entries.');
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
