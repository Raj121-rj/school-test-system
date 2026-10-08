'use strict';
const path = require('path');
const { createApp } = require('./src/http');
const db = require('./src/db');

function build() {
  const app = createApp({ publicDir: path.join(__dirname, 'public') });
  ['auth', 'people', 'tests', 'analysis', 'dashboard', 'admin'].forEach((m) => require('./src/routes/' + m)(app));
  app.health = () => db.q('SELECT 1');
  return app;
}

async function main() {
  await db.init();
  await db.migrate();
  await require('./src/seed').seed({ demo: process.env.SEED_DEMO === 'true' });
  const app = build();
  const port = Number(process.env.PORT) || 3000;
  const server = await app.listen(port);
  console.log(`[ready] http://localhost:${port}`);
  const stop = () => { console.log('[stop] shutting down'); server.close(() => Promise.resolve(db.close()).finally(() => process.exit(0))); setTimeout(() => process.exit(0), 8000).unref(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
if (require.main === module) main().catch((e) => { console.error('[fatal]', e); process.exit(1); });
module.exports = { build };
