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

// Seed a starter status catalog only if empty — real business codes should be
// reviewed and edited by the user before go-live (see plan §4/§10).
const catalogCount = db.prepare('SELECT COUNT(*) AS n FROM status_catalog').get().n;
if (catalogCount === 0) {
  const insert = db.prepare(
    'INSERT INTO status_catalog (code, label_ru, emoji, is_final, sort_order) VALUES (?, ?, ?, ?, ?)'
  );
  const seed = [
    ['AT_WAREHOUSE_CN', 'На складе в Китае', '🏭', 0, 1],
    ['IN_TRANSIT', 'В пути', '🚚', 0, 2],
    ['AT_BORDER', 'На границе', '🛂', 0, 3],
    ['CUSTOMS', 'На таможне', '📋', 0, 4],
    ['DELIVERED', 'Доставлен', '✅', 1, 5],
  ];
  for (const row of seed) insert.run(...row);
}

module.exports = db;
