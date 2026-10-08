'use strict';
// Database access. Production uses PostgreSQL (pg). Tests can inject another driver with use().
let driver = null;

function use(d) { driver = d; }

async function init() {
  if (driver) return driver;
  const { Pool, types } = require('pg');
  types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v))); // NUMERIC -> number
  types.setTypeParser(20, (v) => parseInt(v, 10)); // BIGINT (COUNT) -> number
  types.setTypeParser(1082, (v) => v); // DATE -> 'YYYY-MM-DD' (no timezone shifts)
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL सेट नहीं है');
  const ssl = process.env.DATABASE_SSL ? process.env.DATABASE_SSL === 'true' : /\.render\.com|sslmode=require/.test(url);
  const pool = new Pool({ connectionString: url, ssl: ssl ? { rejectUnauthorized: false } : false, max: 10 });
  pool.on('error', (e) => console.error('[pg pool]', e.message));
  driver = {
    query: (t, p) => pool.query(t, p),
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const r = await fn(c);
        await c.query('COMMIT');
        return r;
      } catch (e) {
        try { await c.query('ROLLBACK'); } catch (_) { /* ignore */ }
        throw e;
      } finally { c.release(); }
    },
    close: () => pool.end(),
  };
  return driver;
}

const wrap = (c) => ({
  q: (t, p) => c.query(t, p),
  one: async (t, p) => (await c.query(t, p)).rows[0] || null,
  all: async (t, p) => (await c.query(t, p)).rows,
});
const q = (t, p) => driver.query(t, p);
const one = async (t, p) => (await driver.query(t, p)).rows[0] || null;
const all = async (t, p) => (await driver.query(t, p)).rows;
const tx = (fn) => driver.tx((c) => fn(wrap(c)));
const close = () => (driver && driver.close ? driver.close() : undefined);

async function migrate() {
  const fs = require('fs');
  const path = require('path');
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  if (driver.exec) await driver.exec(sql); else await driver.query(sql);
}

module.exports = { use, init, q, one, all, tx, close, migrate };
