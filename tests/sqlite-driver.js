'use strict';
// Test-only database driver: runs the app's SQL on Node's built-in SQLite so the whole backend can be exercised without PostgreSQL.
// (Production always uses PostgreSQL via pg.)
const { DatabaseSync } = require('node:sqlite');

const convertSql = (sql) => sql.replace(/\$(\d+)/g, '?$1').replace(/\bILIKE\b/g, 'LIKE');
const schemaToSqlite = (sql) => sql
  .replace(/SERIAL PRIMARY KEY/g, 'INTEGER PRIMARY KEY AUTOINCREMENT')
  .replace(/TIMESTAMPTZ/g, 'TEXT')
  .replace(/NUMERIC\(\d+,\d+\)/g, 'REAL')
  .replace(/\bBOOLEAN\b/g, 'INTEGER')
  .replace(/\bDATE\b/g, 'TEXT');

function createSqliteDriver() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const norm = (p) => (p || []).map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v));
  function run(sql, params) {
    const s = convertSql(sql);
    try {
      const stmt = db.prepare(s);
      if (/^\s*(SELECT|WITH)/i.test(s) || /\bRETURNING\b/i.test(s)) {
        const rows = stmt.all(...norm(params)).map((r) => ({ ...r }));
        return { rows, rowCount: rows.length };
      }
      const info = stmt.run(...norm(params));
      return { rows: [], rowCount: Number(info.changes) };
    } catch (e) {
      if (/UNIQUE constraint failed/.test(e.message)) e.code = '23505';
      else if (/FOREIGN KEY constraint failed/.test(e.message)) e.code = '23503';
      e.message += ' [SQL: ' + s.replace(/\s+/g, ' ').slice(0, 160) + ']';
      throw e;
    }
  }
  const conn = { query: async (t, p) => run(t, p) };
  return {
    query: conn.query,
    exec: async (sql) => db.exec(schemaToSqlite(sql)),
    async tx(fn) {
      db.exec('BEGIN');
      try { const r = await fn(conn); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    close: () => db.close(),
  };
}
module.exports = { createSqliteDriver };
