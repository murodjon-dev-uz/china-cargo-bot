const fs = require('node:fs/promises');
const path = require('node:path');
const { pool, close } = require('./db');

async function migrate() {
  const sql = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

if (require.main === module) {
  migrate()
    .then(() => console.log('Database migrations applied'))
    .catch((error) => { console.error(error); process.exitCode = 1; })
    .finally(close);
}

module.exports = { migrate };
