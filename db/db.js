const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Migration: `stage` was added after orders already existed in the wild —
// CREATE TABLE IF NOT EXISTS above is a no-op on an existing table, so add
// the column by hand when upgrading a pre-existing database.
const orderColumns = db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);
if (!orderColumns.includes('stage')) {
  db.exec("ALTER TABLE orders ADD COLUMN stage TEXT NOT NULL DEFAULT 'AT_FACTORY'");
}

module.exports = db;
