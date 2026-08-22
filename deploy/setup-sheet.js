// One-time setup script: creates "Заявки" (fixed order data) and "Трекинг"
// (dynamic status tracking) tabs. Safe to re-run.
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const { google } = require('googleapis');
const path = require('node:path');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

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

  // Rename first sheet to "Заявки"
  if (!existingTitles.includes('Заявки')) {
    requests.push({
      updateSheetProperties: {
        properties: { sheetId: firstSheetId, title: 'Заявки' },
        fields: 'title',
      },
    });
  }

  // Create "Трекинг" tab if it doesn't exist
  if (!existingTitles.includes('Трекинг')) {
    requests.push({ addSheet: { properties: { title: 'Трекинг' } } });
  }

  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests } });
    console.log('Created/renamed tabs.');
  }

  // Re-fetch to get real sheetIds
  const meta2 = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const ordersSheet = meta2.data.sheets.find((s) => s.properties.title === 'Заявки');
  const trackingSheet = meta2.data.sheets.find((s) => s.properties.title === 'Трекинг');

  // Headers for "Заявки" (fixed data only)
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Заявки!A1:E1',
    valueInputOption: 'RAW',
    requestBody: {
      values: [['Cargo ID', 'Client', 'Cargo', 'Route', 'ETA']],
    },
  });

  // Headers for "Трекинг" (starts with just Cargo ID, grows as statuses are added)
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Трекинг!A1:A1',
    valueInputOption: 'RAW',
    requestBody: {
      values: [['Cargo ID']],
    },
  });

  // Bold header rows
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId: ordersSheet.properties.sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: 'userEnteredFormat.textFormat.bold',
          },
        },
        {
          repeatCell: {
            range: { sheetId: trackingSheet.properties.sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: 'userEnteredFormat.textFormat.bold',
          },
        },
      ],
    },
  });

  console.log('Sheet setup complete: "Заявки" (fixed) and "Трекинг" (dynamic).');
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
