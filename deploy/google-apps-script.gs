// Google Apps Script for Google Sheets
// Reacts instantly to ANY edit on either tab — single cell, whole row,
// or a multi-row paste/delete — and pushes the full affected rows to the bot.
// The sheet is always the source of truth: the server reconciles its copy to
// match exactly, so edits, reordering, and deletions are all handled
// correctly, not just appends.
//
// To install:
// 1. Open Google Sheet
// 2. Go to Extensions → Apps Script
// 3. Copy this entire file into the editor
// 4. Set WEBHOOK_BASE_URL and WEBHOOK_SECRET (see below, use ngrok or Cloud Run URL;
//    the secret must match WEBHOOK_SECRET in the bot's .env)
// 5. Click Deploy → New deployment → Type: Web app
// 6. Run onOpen(), then use the China Cargo menu to enable auto-sync

// ============ CONFIGURATION ============
const WEBHOOK_BASE_URL = PropertiesService.getScriptProperties().getProperty('WEBHOOK_BASE_URL');
// Paste the value of WEBHOOK_SECRET from the bot's .env here, in the Apps
// Script editor only — it is deliberately not stored in the repository.
// Without a matching secret the bot rejects every request with 401
// (see webhook.js's requireWebhookSecret).
const WEBHOOK_SECRET = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');

const TRACKING_SHEET_NAME = 'Трекинг';
const ORDERS_SHEET_NAME = 'Заявки';
// Access list: a phone must be on this tab for its owner to use the bot.
const CONTACTS_SHEET_NAME = 'Контакты';
// Same columns as "Контакты". Being listed here instead is what makes
// someone a manager — there is no list of Telegram IDs anywhere.
const MANAGERS_SHEET_NAME = 'Менеджеры';
const CONTACT_NAME_HEADER = 'Имя клиента';
const CONTACT_PHONE_HEADER = 'Номер телефона';
const CONTACT_HEADERS = [CONTACT_NAME_HEADER, CONTACT_PHONE_HEADER, 'Статус', 'Дата входа'];
const CARGO_ID_COL = 1; // Column A on both sheets
const STATUS_PREFIX = 'Status';
const DATE_PREFIX = 'Date';

// The "Этап" column is the ONLY dropdown-driven field in the sheets — exactly
// three fixed values the bot uses for its own logic (digest filtering, list
// badges). It's separate from the free-text Status columns in "Трекинг",
// which stay untouched, freely-written text. Must match db/queries.js STAGES.
const STAGE_COL_NAME = 'Этап';
const STAGE_VALUES = ['🏭 На заводе', '🚚 В пути', '✅ Доставлен'];

// ============ TRIGGERS ============

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('China Cargo')
    .addItem('Enable auto-sync', 'enableAutoSync')
    .addItem('Disable auto-sync', 'disableAutoSync')
    .addItem('Setup "Этап" column', 'setupStageColumn')
    .addItem('Setup "Контакты" sheet', 'setupContactsSheet')
    .addItem('Setup "Менеджеры" sheet', 'setupManagersSheet')
    .addItem('Sync contacts now', 'syncContacts')
    .addToUi();
}

// One-time (idempotent) setup: adds the "Этап" column to "Заявки" if it's
// missing, and applies a dropdown (data validation) restricting it to the
// three fixed stage values. Safe to re-run — existing cell values are left
// alone, only the column/validation are ensured.
function setupStageColumn() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(ORDERS_SHEET_NAME);
  if (!sheet) {
    SpreadsheetApp.getUi().alert(`Лист "${ORDERS_SHEET_NAME}" не найден`);
    return;
  }

  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  let stageCol = headers.findIndex((h) => h && h.toString().trim() === STAGE_COL_NAME) + 1;

  if (stageCol === 0) {
    stageCol = lastCol + 1;
    sheet.getRange(1, stageCol).setValue(STAGE_COL_NAME).setFontWeight('bold');
  }

  const lastRow = Math.max(sheet.getLastRow(), 2);
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(STAGE_VALUES, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, stageCol, lastRow - 1, 1).setDataValidation(rule);

  SpreadsheetApp.getUi().alert(`Готово! Колонка "${STAGE_COL_NAME}" настроена с выпадающим списком. ✅`);
}

// One-time (idempotent) setup: creates the access-list tab with its four
// headers if it is missing. Existing rows are never touched.
function setupContactsSheet() {
  setupAccessSheet(CONTACTS_SHEET_NAME);
}

function setupManagersSheet() {
  setupAccessSheet(MANAGERS_SHEET_NAME);
}

function setupAccessSheet(name) {
  const spreadsheet = SpreadsheetApp.getActive();
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }
  const width = CONTACT_HEADERS.length;
  const existing = sheet.getRange(1, 1, 1, width).getValues()[0];
  const empty = existing.every(function (h) { return !h; });
  if (empty) {
    sheet.getRange(1, 1, 1, width).setValues([CONTACT_HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange(2, 2, sheet.getMaxRows() - 1, 1).setNumberFormat('@'); // keep +998... as text
  }
  SpreadsheetApp.getUi().alert('Лист "' + name + '" готов. Заполняйте "' + CONTACT_NAME_HEADER + '" и "' + CONTACT_PHONE_HEADER + '". ✅');
}

// Sends the WHOLE access list. Never send a subset: the bot reconciles against
// this payload, so a number missing from it is treated as revoked.
function pushContacts(sheetName, role) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sheet) return 0;
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    sendWebhook('/webhook/contacts-sync', { role: role, rows: [] });
    return 0;
  }
  const headers = data[0];
  const rows = [];
  for (let row = 2; row <= data.length; row++) {
    const rowData = data[row - 1];
    const phone = getCell(headers, rowData, CONTACT_PHONE_HEADER);
    if (!phone) continue;
    rows.push({ name: getCell(headers, rowData, CONTACT_NAME_HEADER), phone: phone, row: row });
  }
  sendWebhook('/webhook/contacts-sync', { role: role, rows: rows });
  return rows.length;
}

function syncContacts() {
  const clients = pushContacts(CONTACTS_SHEET_NAME, 'client');
  const managers = pushContacts(MANAGERS_SHEET_NAME, 'manager');
  SpreadsheetApp.getUi().alert('Клиентов: ' + clients + ', менеджеров: ' + managers + ' ✅');
}

function enableAutoSync() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'onEdit') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
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

// ============ EDIT HANDLER ============

function onEdit(e) {
  const sheet = e.source.getActiveSheet();
  const sheetName = sheet.getName();

  if (sheetName === CONTACTS_SHEET_NAME) {
    pushContacts(CONTACTS_SHEET_NAME, 'client');
    return;
  }

  if (sheetName === MANAGERS_SHEET_NAME) {
    pushContacts(MANAGERS_SHEET_NAME, 'manager');
    return;
  }

  if (sheetName !== TRACKING_SHEET_NAME && sheetName !== ORDERS_SHEET_NAME) {
    return;
  }

  const startRow = e.range.getRow();
  const numRows = e.range.getNumRows();
  if (startRow === 1 && numRows === 1) {
    return; // header-only edit
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  // Every row touched by this edit (covers multi-row paste/delete), skipping
  // the header row if it was part of the range.
  const firstDataRow = Math.max(startRow, 2);
  const lastDataRow = startRow + numRows - 1;

  if (sheetName === TRACKING_SHEET_NAME) {
    const rows = [];
    for (let row = firstDataRow; row <= lastDataRow; row++) {
      const rowData = data[row - 1];
      if (!rowData) continue;
      const cargoId = rowData[CARGO_ID_COL - 1];
      if (!cargoId) continue;
      rows.push({ cargoId: cargoId.toString().trim(), statuses: collectStatuses(headers, rowData) });
    }
    if (rows.length > 0) sendWebhook('/webhook/tracking-sync', { rows: rows });
  } else {
    const rows = [];
    for (let row = firstDataRow; row <= lastDataRow; row++) {
      const rowData = data[row - 1];
      if (!rowData) continue;
      const cargoId = rowData[CARGO_ID_COL - 1];
      if (!cargoId) continue;
      rows.push({
        cargoId: cargoId.toString().trim(),
        client: getCell(headers, rowData, 'Client'),
        phone: getCell(headers, rowData, 'Телефон'),
        cargo: getCell(headers, rowData, 'Cargo'),
        route: getCell(headers, rowData, 'Route'),
        eta: formatDate(getCellRaw(headers, rowData, 'ETA')),
        stage: getCell(headers, rowData, STAGE_COL_NAME),
      });
    }
    if (rows.length > 0) sendWebhook('/webhook/order-sync', { rows: rows });
  }
}

// ============ HELPERS ============

function collectStatuses(headers, rowData) {
  const statuses = [];
  let pairNum = 1;
  while (true) {
    const statusCol = findColumnByHeader(headers, `${STATUS_PREFIX} ${pairNum}`);
    if (statusCol < 0) break;
    const dateCol = findColumnByHeader(headers, `${DATE_PREFIX} ${pairNum}`);
    const statusValue = rowData[statusCol - 1];
    const dateValue = dateCol > 0 ? rowData[dateCol - 1] : '';
    if (statusValue) {
      statuses.push({ text: statusValue.toString().trim(), date: formatDate(dateValue) });
    }
    pairNum++;
  }
  return statuses;
}

function getCell(headers, rowData, headerName) {
  const col = findColumnByHeader(headers, headerName);
  if (col < 0) return '';
  const value = rowData[col - 1];
  return value ? value.toString().trim() : '';
}

function getCellRaw(headers, rowData, headerName) {
  const col = findColumnByHeader(headers, headerName);
  return col < 0 ? '' : rowData[col - 1];
}

function sendWebhook(path, data) {
  try {
    if (!WEBHOOK_BASE_URL || !WEBHOOK_SECRET) {
      throw new Error('Set WEBHOOK_BASE_URL and WEBHOOK_SECRET in Apps Script project properties');
    }
    const payload = JSON.stringify(data);
    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Webhook-Secret': WEBHOOK_SECRET },
      payload: payload,
      muteHttpExceptions: true
    };
    const response = UrlFetchApp.fetch(WEBHOOK_BASE_URL + path, options);
    if (response.getResponseCode() === 200) {
      Logger.log(`✅ ${path}: ${(data.rows || []).length} row(s) synced`);
    } else {
      Logger.log(`❌ ${path} failed (${response.getResponseCode()}): ${response.getContentText()}`);
    }
  } catch (err) {
    Logger.log(`❌ ${path} error: ${err.message}`);
    // Don't block the user if webhook fails
  }
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
  if (!date) return '';
  if (typeof date === 'string') return date;
  if (date instanceof Date) {
    // toISOString() converts to UTC first, which silently shifts a
    // midnight-local date (e.g. entered via the date picker) back a day for
    // any positive-offset timezone like Asia/Tashkent (UTC+5). Format in the
    // spreadsheet's own timezone instead, so the date shown to clients
    // always matches what the manager actually typed/picked.
    return Utilities.formatDate(date, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  }
  return '';
}
