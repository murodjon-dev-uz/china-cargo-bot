const { google } = require('googleapis');
const config = require('./config');
const logger = require('./lib/logger');

let sheetsClientPromise;

function getSheetsClient() {
  if (!sheetsClientPromise) {
    const auth = new google.auth.GoogleAuth({
      keyFile: config.googleServiceAccountKeyPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    sheetsClientPromise = auth.getClient().then((authClient) => google.sheets({ version: 'v4', auth: authClient }));
  }
  return sheetsClientPromise;
}

/**
 * Reads a whole tab and returns an array of objects keyed by the header row
 * (row 1). Blank trailing rows are skipped. Each object also carries a
 * 1-based `_row` number for later writeCell() calls.
 */
async function readTab(tabName) {
  const sheets = await getSheetsClient();
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: config.spreadsheetId,
      range: `${tabName}!A:Z`,
    });
    const rows = res.data.values || [];
    if (rows.length === 0) return [];
    const headers = rows[0].map((h) => String(h).trim());
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every((c) => !String(c || '').trim())) continue;
      const obj = { _row: i + 1 };
      headers.forEach((h, idx) => {
        obj[h] = row[idx] !== undefined ? String(row[idx]).trim() : '';
      });
      out.push(obj);
    }
    return out;
  } catch (err) {
    logger.error('sheets.readTab failed', tabName, err.message);
    throw err;
  }
}

async function writeCell(tabName, rowNumber, column, value) {
  const sheets = await getSheetsClient();
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.spreadsheetId,
      range: `${tabName}!${column}${rowNumber}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[value]] },
    });
  } catch (err) {
    logger.warn('sheets.writeCell failed', tabName, rowNumber, column, err.message);
  }
}

async function appendRow(tabName, values) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: config.spreadsheetId,
    range: `${tabName}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [values] },
  });
}

module.exports = { readTab, writeCell, appendRow };
