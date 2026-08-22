// One-time setup script: creates the "Заявки" and "Статусы для бота" tabs
// with correct headers and status dropdowns. Safe to re-run (skips tabs
// that already exist by the expected name).
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const { google } = require('googleapis');
const path = require('node:path');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const STATUS_CODES = ['AT_WAREHOUSE_CN', 'IN_TRANSIT', 'AT_BORDER', 'CUSTOMS', 'DELIVERED'];

async function main() {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, '..', 'service-account.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existingTitles = meta.data.sheets.map((s) => s.properties.title);
  const firstSheetId = meta.data.sheets[0].properties.sheetId;

  const requests = [];

  // Reuse the first existing tab (e.g. "Лист2") as "Заявки" instead of leaving
  // an empty unused tab around.
  if (!existingTitles.includes('Заявки')) {
    requests.push({
      updateSheetProperties: {
        properties: { sheetId: firstSheetId, title: 'Заявки' },
        fields: 'title',
      },
    });
  }
  if (!existingTitles.includes('Статусы для бота')) {
    requests.push({ addSheet: { properties: { title: 'Статусы для бота' } } });
  }

  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests } });
    console.log('Created/renamed tabs.');
  }

  // Re-fetch to get real sheetIds for both tabs now that they exist.
  const meta2 = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const ordersSheet = meta2.data.sheets.find((s) => s.properties.title === 'Заявки');
  const statusesSheet = meta2.data.sheets.find((s) => s.properties.title === 'Статусы для бота');

  // Headers
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Заявки!A1:F1',
    valueInputOption: 'RAW',
    requestBody: {
      values: [['Номер заявки', 'Клиент', 'Описание груза', 'Маршрут', 'ETA', 'Текущий статус (при создании)']],
    },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: "'Статусы для бота'!A1:D1",
    valueInputOption: 'RAW',
    requestBody: { values: [['Номер заявки', 'Новый статус', 'Комментарий', 'Processed']] },
  });

  // Dropdown data validation for status columns (rows 2-500 — plenty of headroom).
  const validationRule = {
    condition: { type: 'ONE_OF_LIST', values: STATUS_CODES.map((v) => ({ userEnteredValue: v })) },
    showCustomUi: true,
    strict: true,
  };
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          setDataValidation: {
            range: {
              sheetId: ordersSheet.properties.sheetId,
              startRowIndex: 1,
              endRowIndex: 500,
              startColumnIndex: 5, // F
              endColumnIndex: 6,
            },
            rule: validationRule,
          },
        },
        {
          setDataValidation: {
            range: {
              sheetId: statusesSheet.properties.sheetId,
              startRowIndex: 1,
              endRowIndex: 500,
              startColumnIndex: 1, // B
              endColumnIndex: 2,
            },
            rule: validationRule,
          },
        },
        // Bold header rows on both tabs
        {
          repeatCell: {
            range: { sheetId: ordersSheet.properties.sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: 'userEnteredFormat.textFormat.bold',
          },
        },
        {
          repeatCell: {
            range: { sheetId: statusesSheet.properties.sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: 'userEnteredFormat.textFormat.bold',
          },
        },
      ],
    },
  });

  console.log('Sheet setup complete: headers + status dropdowns on both tabs.');
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
