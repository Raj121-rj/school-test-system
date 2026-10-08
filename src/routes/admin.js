'use strict';
// Settings, sessions, holidays, audit log, demo-data removal
const db = require('../db');
const { HttpError } = require('../http');
const A = require('../auth');
const { audit, getSettings, setSetting } = require('../core');
const { asInt, toYmd } = require('../util');

module.exports = function register(app) {
  const admin = A.requireRole('admin');
  const staff = A.requireRole('admin', 'teacher');

  app.get('/api/settings', admin, async (req, res) => {
    const demo = await db.one('SELECT COUNT(*) AS n FROM students WHERE is_demo = true');
    res.json({
      settings: await getSettings(),
      sessions: await db.all('SELECT id, name, is_current FROM sessions ORDER BY id'),
      holidays: await db.all('SELECT id, start_date, end_date, note FROM holidays ORDER BY start_date'),
      demo_students: demo.n,
    });
  });
  app.get('/api/holidays', staff, async (req, res) => res.json({ holidays: await db.all('SELECT id, start_date, end_date, note FROM holidays ORDER BY start_date') }));

  app.put('/api/settings', admin, async (req, res) => {
    const b = req.body;
    const out = {};
    if (b.school_name != null) { const v = String(b.school_name).trim(); if (!v || v.length > 100) throw new HttpError(400, 'विद्यालय का नाम 1-100 अक्षरों का हो'); out.school_name = v; }
    if (b.attention_below_pct != null) { const n = Number(b.attention_below_pct); if (!(n >= 1 && n <= 100)) throw new HttpError(400, 'प्रतिशत 1 से 100 के बीच हो'); out.attention_below_pct = String(n); }
    if (b.ranking_min_tests != null) { const n = Number(b.ranking_min_tests); if (!Number.isInteger(n) || n < 1 || n > 50) throw new HttpError(400, 'न्यूनतम टेस्ट 1 से 50 के बीच हो'); out.ranking_min_tests = String(n); }
    if (b.restrict_future_entry != null) out.restrict_future_entry = b.restrict_future_entry ? 'true' : 'false';
    for (const [k, v] of Object.entries(out)) await setSetting(k, v);
    await audit(req, 'settings_update', 'settings', null, out);
    res.json({ ok: true, settings: await getSettings() });
  });

  app.post('/api/sessions', admin, async (req, res) => {
    const name = String(req.body.name || '').trim();
    if (!/^\d{4}-\d{2}$/.test(name)) throw new HttpError(400, 'सत्र का नाम 2027-28 जैसे फ़ॉर्मैट में लिखें');
    const row = await db.one('INSERT INTO sessions (name, is_current) VALUES ($1, false) RETURNING id', [name]);
    await audit(req, 'session_add', 'session', row.id, { name });
    res.json({ id: row.id }, 201);
  });
  app.post('/api/sessions/:id/current', admin, async (req, res) => {
    const id = asInt(req.params.id);
    if (!(await db.one('SELECT id FROM sessions WHERE id = $1', [id]))) throw new HttpError(404, 'सत्र नहीं मिला');
    await db.tx(async (c) => {
      await c.q('UPDATE sessions SET is_current = false');
      await c.q('UPDATE sessions SET is_current = true WHERE id = $1', [id]);
    });
    await audit(req, 'session_current', 'session', id);
    res.json({ ok: true });
  });

  app.post('/api/holidays', admin, async (req, res) => {
    const s = toYmd(req.body.start_date);
    const e = toYmd(req.body.end_date || req.body.start_date);
    if (!s || !e || e < s) throw new HttpError(400, 'तारीखें सही नहीं हैं');
    const row = await db.one('INSERT INTO holidays (start_date, end_date, note) VALUES ($1,$2,$3) RETURNING id', [s, e, String(req.body.note || '').trim().slice(0, 100)]);
    await audit(req, 'holiday_add', 'holiday', row.id, { s, e });
    res.json({ id: row.id }, 201);
  });
  app.delete('/api/holidays/:id', admin, async (req, res) => {
    const id = asInt(req.params.id);
    await db.q('DELETE FROM holidays WHERE id = $1', [id]);
    await audit(req, 'holiday_delete', 'holiday', id);
    res.json({ ok: true });
  });

  app.get('/api/audit', admin, async (req, res) => {
    const params = [];
    let where = '1 = 1';
    const add = (cond, v) => { params.push(v); where += ' AND ' + cond.replace('?', '$' + params.length); };
    if (req.query.action) add('LOWER(action) LIKE ?', '%' + String(req.query.action).toLowerCase() + '%');
    if (req.query.user) add('LOWER(username) LIKE ?', '%' + String(req.query.user).toLowerCase() + '%');
    if (req.query.from) { const d = toYmd(req.query.from); if (!d) throw new HttpError(400, 'तारीख गलत है'); add('created_at >= ?', d); }
    if (req.query.to) {
      const d = toYmd(req.query.to);
      if (!d) throw new HttpError(400, 'तारीख गलत है');
      add('created_at < ?', new Date(Date.parse(d + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10));
    }
    const total = (await db.one(`SELECT COUNT(*) AS n FROM audit_logs WHERE ${where}`, params)).n;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const rows = await db.all(`SELECT id, created_at, username, action, entity, entity_id, details, ip FROM audit_logs WHERE ${where} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`, params);
    res.json({ total, rows });
  });

  // Remove demo teacher/students/marks. Real data is untouched.
  app.post('/api/settings/delete-demo', admin, async (req, res) => {
    if (req.body.confirm !== 'DELETE') throw new HttpError(400, 'पुष्टि के लिए DELETE लिखें');
    await db.tx(async (c) => {
      await c.q('DELETE FROM students WHERE is_demo = true');
      await c.q('DELETE FROM users WHERE is_demo = true');
      await c.q("UPDATE tests SET marks_locked = false, status = 'Scheduled', locked_by = NULL, locked_at = NULL WHERE marks_locked = true AND NOT EXISTS (SELECT 1 FROM marks m WHERE m.test_id = tests.id)");
    });
    await audit(req, 'demo_deleted', 'settings');
    res.json({ ok: true });
  });
};
