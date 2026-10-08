'use strict';
// Starts the whole site on http://localhost:3111 with an in-memory SQLite stand-in + demo data (for browser testing only).
const db = require('../src/db');
const { createSqliteDriver } = require('./sqlite-driver');
db.use(createSqliteDriver());
(async () => {
  await db.migrate();
  await require('../src/seed').seed({ demo: true });
  const app = require('../server').build();
  await app.listen(Number(process.env.PORT) || 3111, '127.0.0.1');
  console.log('ready');
})().catch((e) => { console.error(e); process.exit(1); });
