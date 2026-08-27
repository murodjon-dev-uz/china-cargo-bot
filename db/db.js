const { Pool, types } = require('pg');
const config = require('../config');

// A DATE column has no time and no zone, but node-postgres turns it into a JS
// Date at LOCAL midnight. Every formatter here reads UTC components, so in
// Asia/Tashkent (UTC+5) an ETA of 2026-09-04 rendered as "3 сентября" — a day
// early, in the one number clients care about most. Hand DATE back as the
// plain "YYYY-MM-DD" string the database actually stores.
types.setTypeParser(types.builtins.DATE, (value) => value);

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
  max: Number(process.env.DB_POOL_SIZE || 10),
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
});

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function ping() { await pool.query('SELECT 1'); }

module.exports = { pool, withTransaction, ping, close: () => pool.end() };
