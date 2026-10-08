'use strict';
// Pre-deploy check (used as part of the Render build): syntax of every JS file, data files, dependencies, pure-logic unit tests.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
let failed = 0;
const ok = (m) => console.log('  ok   ' + m);
const bad = (m) => { failed++; console.log('  FAIL ' + m); };
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name === 'node_modules' || e.name.startsWith('.') ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

const js = walk(root).filter((f) => f.endsWith('.js'));
let syntaxBad = 0;
for (const f of js) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { syntaxBad++; bad(`syntax error in ${path.relative(root, f)}\n${r.stderr}`); }
}
if (!syntaxBad) ok(`${js.length} JavaScript files: syntax OK`);

try {
  const cal = require('../data/master_calendar.json');
  const ch = require('../data/chapters.json');
  const chapters = Object.values(ch).reduce((n, g) => n + Object.values(g).reduce((m, l) => m + l.length, 0), 0);
  cal.length === 192 ? ok('Master Calendar: 192 tests') : bad(`Master Calendar must have 192 tests, found ${cal.length}`);
  chapters === 335 ? ok('Syllabus: 335 chapters') : bad(`expected 335 chapters, found ${chapters}`);
} catch (e) { bad('data files: ' + e.message); }

for (const m of ['pg', 'exceljs']) {
  try { require.resolve(m); ok('dependency ' + m); } catch (_) { bad(`dependency "${m}" missing - run: npm install`); }
}
for (const f of ['public/index.html', 'public/core.js', 'src/schema.sql']) fs.existsSync(path.join(root, f)) ? null : bad('missing file ' + f);

const t = spawnSync(process.execPath, [path.join(root, 'tests/run.js')], { env: { ...process.env, SKIP_INTEGRATION: '1' }, encoding: 'utf8' });
process.stdout.write(t.stdout);
if (t.status !== 0) { bad('unit tests failed'); process.stdout.write(t.stderr); }
console.log(failed ? `\ncheck FAILED (${failed})` : '\ncheck passed');
process.exit(failed ? 1 : 0);
