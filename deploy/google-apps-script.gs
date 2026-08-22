// Google Apps Script for Google Sheets
// Automatically sends webhook to our server when Трекинг sheet is updated.
//
// To install:
// 1. Open Google Sheet
// 2. Go to Extensions → Apps Script
// 3. Copy this entire file into the editor
// 4. Set WEBHOOK_URL (see below, use ngrok or Cloud Run URL)
// 5. Click Deploy → New deployment → Type: Web app
// 6. Run onOpen() to enable trigger

// ============ CONFIGURATION ============
// Replace with your ngrok URL or Cloud Run URL
const WEBHOOK_URL = 'http://localhost:3000/webhook/tracking-update';
// Or use ngrok (after starting ngrok):
// const WEBHOOK_URL = 'https://your-ngrok-url.ngrok.io/webhook/tracking-update';

const TRACKING_SHEET_NAME = 'Трекинг';
const CARGO_ID_COL = 1; // Column A
const STATUS_PREFIX = 'Status';
const DATE_PREFIX = 'Date';

// ============ TRIGGERS ============

function onOpen() {
  // Create custom menu
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('China Cargo')
    .addItem('Enable auto-sync', 'enableAutoSync')
    .addItem('Disable auto-sync', 'disableAutoSync')
    .addToUi();
}

function enableAutoSync() {
  // Remove existing triggers
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'onEdit') {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  // Create new onEdit trigger
  ScriptApp.newTrigger('onEdit')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onEdit()
    .create();

  SpreadsheetApp.getUi().alert('Auto-sync enabled! ✅');
}

function disableAutoSync() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'onEdit') {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  SpreadsheetApp.getUi().alert('Auto-sync disabled');
}

// ============ WEBHOOK HANDLER ============

function onEdit(e) {
  const sheet = e.source.getActiveSheet();

  // Only trigger on Трекинг sheet
  if (sheet.getName() !== TRACKING_SHEET_NAME) {
    return;
  }

  const range = e.range;
  const row = range.getRow();
  const col = range.getColumn();

  // Skip header row
  if (row === 1) {
    return;
  }

  const sheet_data = sheet.getDataRange().getValues();
  const headers = sheet_data[0];

  // Get Cargo ID from this row
  const cargoId = sheet_data[row - 1][CARGO_ID_COL - 1];
  if (!cargoId) {
    return; // Empty row
  }

  // Check if this is a Status or Date column
  const header = headers[col - 1];
  if (!header || !header.includes(STATUS_PREFIX)) {
    return; // Not a status column
  }

  // Get the status value and corresponding date
  const statusValue = range.getValue();
  if (!statusValue) {
    return; // Empty cell
  }

  // Find corresponding date column (Status N → Date N pair)
  const statusNum = extractNumber(header);
  const dateHeader = `${DATE_PREFIX} ${statusNum}`;
  const dateCol = findColumnByHeader(headers, dateHeader);

  const dateValue = dateCol > 0 ? sheet_data[row - 1][dateCol - 1] : new Date().toISOString().split('T')[0];

  // Send webhook
  sendWebhook({
    cargoId: cargoId.toString().trim(),
    statusText: statusValue.toString().trim(),
    date: formatDate(dateValue)
  });
}

// ============ HELPERS ============

function sendWebhook(data) {
  try {
    const payload = JSON.stringify(data);
    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: payload,
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(WEBHOOK_URL, options);
    const result = JSON.parse(response.getContentText());

    if (response.getResponseCode() === 200) {
      Logger.log(`✅ Webhook sent: ${data.cargoId} → ${data.statusText}`);
    } else {
      Logger.log(`❌ Webhook failed (${response.getResponseCode()}): ${response.getContentText()}`);
    }
  } catch (err) {
    Logger.log(`❌ Webhook error: ${err.message}`);
    // Don't block the user if webhook fails
  }
}

function extractNumber(str) {
  const match = str.match(/\d+/);
  return match ? match[0] : null;
}

function findColumnByHeader(headers, targetHeader) {
  for (let i = 0; i < headers.length; i++) {
    if (headers[i] && headers[i].toString().trim() === targetHeader) {
      return i + 1;
    }
  }
  return -1;
}

function formatDate(date) {
  if (typeof date === 'string') {
    return date;
  }
  if (date instanceof Date) {
    return date.toISOString().split('T')[0];
  }
  return new Date().toISOString().split('T')[0];
}
