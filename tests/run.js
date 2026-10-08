'use strict';
let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('  FAIL', name, '\n      ', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n       ') : e); }
}
(async () => {
  await require('./unit.test.js')(t);
  if (!process.env.SKIP_INTEGRATION) { try { require.resolve('node:sqlite'); await require('./integration.test.js')(t); } catch (e) { if (e.code === 'MODULE_NOT_FOUND' || /node:sqlite/.test(String(e.message))) console.log('  skip  integration tests need Node 22+'); else { fail++; console.log('  FAIL integration setup', e.stack || e); } } }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
