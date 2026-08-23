// Migrate Google Sheets from old structure to new structure
// Old: "Заявки" + "Статусы для бота" (vertical)
// New: "Заявки" (master data) + "Трекинг" (horizontal Status 1, Date 1, Status 2, Date 2...)

const { GoogleAuth } = require('google-auth-library');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH ||
  path.join(__dirname, '..', 'service-account.json');

async function migrate() {
  console.log('🔄 Starting sheets migration...');

  const auth = new GoogleAuth({
    keyFile: SERVICE_ACCOUNT_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = process.env.SPREADSHEET_ID;

  if (!spreadsheetId) {
    throw new Error('SPREADSHEET_ID not set in .env');
  }

  // 1. Read old "Заявки" sheet
  console.log('📖 Reading old "Заявки" sheet...');
  const zakavkiResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Заявки!A:F"
  });
  const zakavkiData = zakavkiResponse.data.values || [];
  console.log(`Found ${zakavkiData.length} rows in "Заявки"`);

  // 2. Read old "Статусы для бота" sheet
  console.log('📖 Reading old "Статусы для бота" sheet...');
  let statusesData = [];
  try {
    const statusesResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Статусы для бота!A:D"
    });
    statusesData = statusesResponse.data.values || [];
    console.log(`Found ${statusesData.length} rows in "Статусы для бота"`);
  } catch (err) {
    console.log('ℹ️  "Статусы для бота" sheet not found (OK if using new structure already)');
  }

  // 3. Parse old data into a map: cargoId → {master data, [statuses]}
  const cargoMap = new Map();

  // Parse Заявки (master data)
  for (let i = 1; i < zakavkiData.length; i++) {
    const row = zakavkiData[i];
    if (!row || !row[0]) continue; // Skip empty rows

    const cargoId = row[0];
    cargoMap.set(cargoId, {
      cargoId,
      client: row[1] || '',
      cargo: row[2] || '',
      route: row[3] || '',
      eta: row[4] || '',
      initialStatus: row[5] || '',
      statuses: []
    });
  }

  // Parse Статусы (old format)
  for (let i = 1; i < statusesData.length; i++) {
    const row = statusesData[i];
    if (!row || !row[0]) continue; // Skip empty rows

    const cargoId = row[0];
    const statusText = row[1] || '';
    const comment = row[2] || '';
    const date = row[3] || new Date().toISOString().split('T')[0];

    if (cargoMap.has(cargoId)) {
      cargoMap.get(cargoId).statuses.push({
        statusText,
        comment,
        date
      });
    }
  }

  // 4. Build new sheet data structure
  console.log('🔨 Building new structure...');

  // New Заявки: Cargo ID, Client, Cargo, Route, ETA (5 columns, no status)
  const newZakavki = [['Cargo ID', 'Client', 'Cargo', 'Route', 'ETA']];
  for (const [cargoId, data] of cargoMap.entries()) {
    newZakavki.push([
      data.cargoId,
      data.client,
      data.cargo,
      data.route,
      data.eta
    ]);
  }

  // New Трекинг: Cargo ID, Status 1, Date 1, Status 2, Date 2, ...
  const maxStatuses = Math.max(...Array.from(cargoMap.values()).map(d => d.statuses.length), 0) || 1;
  const trackingHeaders = ['Cargo ID'];
  for (let i = 1; i <= maxStatuses; i++) {
    trackingHeaders.push(`Status ${i}`, `Date ${i}`);
  }

  const newTracking = [trackingHeaders];
  for (const [cargoId, data] of cargoMap.entries()) {
    const row = [cargoId];
    for (let i = 0; i < maxStatuses; i++) {
      if (i < data.statuses.length) {
        row.push(data.statuses[i].statusText);
        row.push(data.statuses[i].date);
      } else {
        row.push('', ''); // Empty status/date pairs
      }
    }
    newTracking.push(row);
  }

  console.log(`New Заявки: ${newZakavki.length} rows`);
  console.log(`New Трекинг: ${newTracking.length} rows with max ${maxStatuses} status pairs`);

  // 5. Clear and rewrite "Заявки" sheet
  console.log('✍️  Writing new "Заявки" sheet...');
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: "Заявки!A:F"
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Заявки!A1",
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: newZakavki }
  });

  // 6. Create or clear "Трекинг" sheet
  console.log('✍️  Writing new "Трекинг" sheet...');

  // First, get existing sheet IDs to check if Трекинг exists
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheets_list = spreadsheet.data.sheets || [];
  let trackingSheetId = null;

  for (const sheet of sheets_list) {
    if (sheet.properties.title === 'Трекинг') {
      trackingSheetId = sheet.properties.sheetId;
      break;
    }
  }

  // If Трекинг doesn't exist, create it
  if (trackingSheetId === null) {
    console.log('🆕 Creating "Трекинг" sheet...');
    const createResponse = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          addSheet: {
            properties: {
              title: 'Трекинг'
            }
          }
        }]
      }
    });
    trackingSheetId = createResponse.data.replies[0].addSheet.properties.sheetId;
  }

  // Clear existing data
  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: "Трекинг!A:Z"
    });
  } catch (err) {
    console.log('ℹ️  Could not clear Трекинг (sheet just created)');
  }

  // Write new data
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Трекинг!A1",
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: newTracking }
  });

  console.log('✅ Migration complete!');
  console.log(`\n📊 Summary:`);
  console.log(`- Заявки: ${newZakavki.length - 1} orders with 5 columns (ID, Client, Cargo, Route, ETA)`);
  console.log(`- Трекинг: ${newTracking.length - 1} orders with ${maxStatuses} status pairs`);
  console.log(`\n📝 You can now delete the old "Статусы для бота" sheet if you want`);
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
});
