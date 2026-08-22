// Fills the "Заявки" and "Статусы для бота" tabs with sample rows for
// end-to-end testing. Safe to re-run — appends below existing rows.
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const { google } = require('googleapis');
const path = require('node:path');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CLIENT_USERNAME = 'defeendeeer'; // the account that already pressed /start

async function main() {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, '..', 'service-account.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  // Two orders created directly with an initial status (CL-001, CL-002),
  // one already delivered to test the "История" split (CL-003).
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Заявки!A2',
    valueInputOption: 'RAW',
    requestBody: {
      values: [
        ['CL-001', CLIENT_USERNAME, 'Запчасти из Шанхая', 'Шанхай → Ташкент', '2026-08-26', 'AT_WAREHOUSE_CN'],
        ['CL-002', CLIENT_USERNAME, 'Оборудование из Гуанчжоу', 'Гуанчжоу → Ташкент', '2026-08-28', 'IN_TRANSIT'],
        ['CL-003', CLIENT_USERNAME, 'Тестовая доставленная заявка', 'Пекин → Ташкент', '2026-08-15', 'DELIVERED'],
      ],
    },
  });

  // One status-change row for CL-001, to test the nightly notification path.
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "'Статусы для бота'!A2",
    valueInputOption: 'RAW',
    requestBody: {
      values: [['CL-001', 'AT_BORDER', 'Ожидает оформления']],
    },
  });

  console.log('Test data added: CL-001, CL-002, CL-003 in «Заявки»; one status update for CL-001 in «Статусы для бота».');
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
