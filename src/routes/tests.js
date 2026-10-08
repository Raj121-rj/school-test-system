'use strict';
// Master Test Calendar, scheduled tests, marks entry (with history/locking), student's own test list.
const db = require('../db');
const { HttpError } = require('../http');
const A = require('../auth');
const { audit, currentSession, getSettings, teacherSubjects, sendTable } = require('../core');
const { asInt, inList, toYmd, todayStr, weekday } = require('../util');
const { normalizeCalendarRows } = require('../calendar');
const { applyCalendar } = require('../calendarStore');
const { readMatrix } = require('../excel');

const STATUSES = ['Scheduled', 'Completed', 'Postponed', 'Cancelled'];
const TEST_SELECT = `SELECT t.id, t.session_id, t.test_code, t.test_no, t.test_date, t.original_date, t.test_type, t.syllabus, t.full_syllabus, t.max_marks, t.duration_min, t.status, t.marks_locked,
  t.class_id, c.grade, c.name AS class_name, t.subject_id, sb.name AS subject_name,
  (SELECT COUNT(*) FROM marks m WHERE m.test_id = t.id) AS entered,
  (SELECT COUNT(*) FROM student_class_history h JOIN students st ON st.id = h.student_id WHERE h.class_id = t.class_id AND h.session_id = t.session_id AND h.status = 'active' AND st.active = true) AS enrolled
  FROM tests t JOIN classes c ON c.id = t.class_id JOIN subjects sb ON sb.id = t.subject_id`;

async function getTest(id) {
  const t = await db.one(`${TEST_SELECT} WHERE t.id = $1`, [id]);
  if (!t) throw new HttpError(404, 'टेस्ट नहीं मिला');
  return t;
}
async function assertStaffTest(user, t) {
  if (user.role === 'admin') return;
  if (!(await teacherSubjects(user)).some((s) => s.subject_id === t.subject_id)) throw new HttpError(403, 'यह टेस्ट आपके विषय का नहीं है');
}
const numOrNull = (v) => (v === '' || v == null ? null : Number(v));
const roster = (t) => db.all(
  `SELECT s.id, s.student_code AS code, s.name, h.roll_no FROM student_class_history h JOIN students s ON s.id = h.student_id
   WHERE h.class_id = $1 AND h.session_id = $2 AND h.status = 'active' AND s.active = true ORDER BY h.roll_no`, [t.class_id, t.session_id]);

module.exports = function register(app) {
  const admin = A.requireRole('admin');
  const staff = A.requireRole('admin', 'teacher');

  app.get('/api/tests', staff, async (req, res) => {
    const sess = await currentSession();
    const params = [sess.id];
    let where = 't.session_id = $1';
    const add = (cond, v) => { params.push(v); where += ' AND ' + cond.replace('?', '$' + params.length); };
    const q = req.query;
    if (q.class_id) add('t.class_id = ?', asInt(q.class_id, 'class_id'));
    if (q.subject_id) add('t.subject_id = ?', asInt(q.subject_id, 'subject_id'));
    if (q.status) { if (!STATUSES.includes(q.status)) throw new HttpError(400, 'स्थिति गलत है'); add('t.status = ?', q.status); }
    for (const [key, cond] of [['from', 't.test_date >= ?'], ['to', 't.test_date <= ?'], ['date', 't.test_date = ?']]) {
      if (q[key]) { const d = toYmd(q[key]); if (!d) throw new HttpError(400, 'तारीख गलत है'); add(cond, d); }
    }
    if (q.pending === '1') { add('t.test_date <= ?', todayStr()); where += " AND t.marks_locked = false AND t.status IN ('Scheduled','Completed')"; }
    if (req.user.role === 'teacher') {
      const ids = (await teacherSubjects(req.user)).map((s) => s.subject_id);
      if (!ids.length) return res.json({ tests: [], today: todayStr() });
      where += ` AND t.subject_id IN (${inList(ids, params.length + 1)})`;
      params.push(...ids);
    }
    res.json({ tests: await db.all(`${TEST_SELECT} WHERE ${where} ORDER BY t.test_date, c.grade, t.test_no`, params), today: todayStr() });
  });

  app.get('/api/tests/:id', staff, async (req, res) => {
    const t = await getTest(asInt(req.params.id));
    await assertStaffTest(req.user, t);
    const settings = await getSettings();
    const chapters = await db.all('SELECT ch.chapter_no, ch.title FROM test_chapters tc JOIN chapters ch ON ch.id = tc.chapter_id WHERE tc.test_id = $1 ORDER BY ch.chapter_no', [t.id]);
    const people = await roster(t);
    const marks = new Map((await db.all('SELECT student_id, marks, status FROM marks WHERE test_id = $1', [t.id])).map((m) => [m.student_id, m]));
    const students = people.map((s) => ({ ...s, marks: marks.has(s.id) ? marks.get(s.id).marks : null, status: marks.has(s.id) ? marks.get(s.id).status : null }));
    let block = null;
    if (!(t.max_marks > 0)) block = 'पूर्णांक (Maximum Marks) सेट नहीं है। एडमिन से सेट करवाएँ।';
    else if (!['Scheduled', 'Completed'].includes(t.status)) block = t.status === 'Postponed' ? 'यह टेस्ट स्थगित है।' : 'यह टेस्ट रद्द है।';
    else if (req.user.role !== 'admin' && t.marks_locked) block = 'अंक लॉक हैं। सुधार के लिए एडमिन से संपर्क करें।';
    else if (req.user.role !== 'admin' && settings.restrict_future_entry === 'true' && t.test_date > todayStr()) block = 'टेस्ट की तारीख से पहले अंक दर्ज नहीं हो सकते।';
    res.json({ test: t, chapters, students, can_edit: !block, block_reason: block, today: todayStr() });
  });

  // Admin: postpone / cancel / change date, max marks, duration
  app.put('/api/tests/:id', admin, async (req, res) => {
    const id = asInt(req.params.id);
    const t = await getTest(id);
    const b = req.body;
    const date = b.test_date ? toYmd(b.test_date) : t.test_date;
    if (!date) throw new HttpError(400, 'तारीख गलत है');
    const maxMarks = numOrNull(b.max_marks);
    if (maxMarks != null && (!(maxMarks > 0) || maxMarks > 1000 || Math.round(maxMarks * 100) / 100 !== maxMarks)) throw new HttpError(400, 'पूर्णांक 0 से बड़ा (अधिकतम 1000) होना चाहिए');
    const dur = numOrNull(b.duration_min);
    if (dur != null && (!Number.isInteger(dur) || dur < 1 || dur > 600)) throw new HttpError(400, 'समय 1 से 600 मिनट के बीच हो');
    let status = b.status || t.status;
    if (!STATUSES.includes(status)) throw new HttpError(400, 'स्थिति गलत है');
    if (t.marks_locked) {
      if (b.status && b.status !== 'Completed') throw new HttpError(400, 'अंक लॉक हैं, इसलिए स्थिति नहीं बदली जा सकती। पहले टेस्ट अनलॉक करें');
      status = 'Completed';
    } else if (status === 'Completed') throw new HttpError(400, '"पूर्ण" स्थिति तभी बनती है जब अंक लॉक हो जाएँ');
    if (['Cancelled', 'Postponed'].includes(status) && t.entered > 0) throw new HttpError(400, 'इस टेस्ट के अंक दर्ज हैं, इसलिए इसे रद्द/स्थगित नहीं कर सकते');
    if (maxMarks != null && t.entered > 0 && (await db.one('SELECT id FROM marks WHERE test_id = $1 AND marks > $2 LIMIT 1', [id, maxMarks]))) throw new HttpError(400, 'कुछ विद्यार्थियों के अंक इस पूर्णांक से ज़्यादा हैं');
    if (date !== t.test_date && !b.force) {
      const settings = await getSettings();
      const warnings = [];
      if (![1, 3, 5].includes(weekday(date))) warnings.push('यह दिन सोमवार/बुधवार/शुक्रवार नहीं है');
      const h = await db.one('SELECT note FROM holidays WHERE start_date <= $1 AND end_date >= $1', [date]);
      if (h) warnings.push(`यह तारीख अवकाश में है${h.note ? ' (' + h.note + ')' : ''}`);
      if ((settings.cycle_start && date < settings.cycle_start) || (settings.cycle_end && date > settings.cycle_end)) warnings.push('यह तारीख टेस्ट-चक्र (12 अक्टूबर 2026 – 15 फ़रवरी 2027) से बाहर है');
      if (warnings.length) return res.json({ error: 'तारीख नियमों से मेल नहीं खाती', warnings, needs_force: true }, 409);
    }
    await db.q('UPDATE tests SET test_date = $1, max_marks = $2, duration_min = $3, status = $4 WHERE id = $5', [date, maxMarks, dur, status, id]);
    await audit(req, 'test_update', 'test', t.test_code, { class: t.grade, subject: t.subject_name, before: { date: t.test_date, max_marks: t.max_marks, duration_min: t.duration_min, status: t.status }, after: { date, max_marks: maxMarks, duration_min: dur, status } });
    res.json({ ok: true });
  });

  // Admin: fill max marks / duration for many tests at once
  app.post('/api/tests/defaults', admin, async (req, res) => {
    const sess = await currentSession();
    const mm = numOrNull(req.body.max_marks);
    const du = numOrNull(req.body.duration_min);
    if (mm == null && du == null) throw new HttpError(400, 'पूर्णांक या समय में से कम से कम एक भरें');
    if (mm != null && (!(mm > 0) || mm > 1000 || Math.round(mm * 100) / 100 !== mm)) throw new HttpError(400, 'पूर्णांक सही नहीं');
    if (du != null && (!Number.isInteger(du) || du < 1 || du > 600)) throw new HttpError(400, 'समय सही नहीं');
    const overwrite = !!req.body.overwrite;
    const params = [sess.id];
    let scope = 'session_id = $1';
    if (req.body.class_id) { params.push(asInt(req.body.class_id, 'class_id')); scope += ` AND class_id = $${params.length}`; }
    let updated = 0;
    if (mm != null) {
      const p = [...params, mm];
      let sql = `UPDATE tests SET max_marks = $${p.length} WHERE ${scope}`;
      if (!overwrite) sql += ' AND max_marks IS NULL';
      else sql += ` AND NOT EXISTS (SELECT 1 FROM marks m WHERE m.test_id = tests.id AND m.marks > $${p.length})`;
      updated += (await db.q(sql, p)).rowCount;
    }
    if (du != null) {
      const p = [...params, du];
      updated += (await db.q(`UPDATE tests SET duration_min = $${p.length} WHERE ${scope}${overwrite ? '' : ' AND duration_min IS NULL'}`, p)).rowCount;
    }
    await audit(req, 'tests_defaults', 'test', null, { max_marks: mm, duration_min: du, overwrite, class_id: req.body.class_id || null });
    res.json({ updated });
  });

  // Marks entry / correction. Every change is written to marks_history.
  app.put('/api/tests/:id/marks', staff, async (req, res) => {
    const id = asInt(req.params.id);
    const t = await getTest(id);
    await assertStaffTest(req.user, t);
    const isAdmin = req.user.role === 'admin';
    if (!(t.max_marks > 0)) throw new HttpError(400, 'इस टेस्ट का पूर्णांक (Maximum Marks) सेट नहीं है। एडमिन से सेट करवाएँ');
    if (!['Scheduled', 'Completed'].includes(t.status)) throw new HttpError(400, `यह टेस्ट "${t.status === 'Postponed' ? 'स्थगित' : 'रद्द'}" है, अंक दर्ज नहीं हो सकते`);
    const settings = await getSettings();
    if (!isAdmin && settings.restrict_future_entry === 'true' && t.test_date > todayStr()) throw new HttpError(400, 'टेस्ट की तारीख से पहले अंक दर्ज नहीं हो सकते');
    const reason = String(req.body.reason || '').trim().slice(0, 300);
    if (t.marks_locked) {
      if (!isAdmin) throw new HttpError(403, 'अंक लॉक हैं। सुधार के लिए एडमिन से संपर्क करें');
      if (!reason) throw new HttpError(400, 'लॉक किए गए अंक बदलने के लिए कारण लिखना ज़रूरी है');
    }
    const entries = Array.isArray(req.body.entries) ? req.body.entries : [];
    const lock = !!req.body.lock;
    if (!entries.length && !lock) throw new HttpError(400, 'सेव करने के लिए कोई अंक नहीं मिले');
    const people = await roster(t);
    const byId = new Map(people.map((p) => [p.id, p]));
    const next = new Map();
    for (const e of entries) {
      const sid = asInt(e.student_id, 'विद्यार्थी');
      const st = byId.get(sid);
      if (!st) throw new HttpError(400, 'कोई विद्यार्थी इस कक्षा का नहीं है');
      if (e.absent) { next.set(sid, { marks: null, status: 'absent' }); continue; }
      if (e.marks === '' || e.marks == null) { next.set(sid, null); continue; }
      const n = Number(String(e.marks).trim());
      if (!Number.isFinite(n) || n < 0 || n > t.max_marks || Math.round(n * 100) / 100 !== n) throw new HttpError(400, `${st.name} (रोल ${st.roll_no}) के अंक गलत हैं — 0 से ${t.max_marks} के बीच संख्या लिखें`);
      next.set(sid, { marks: n, status: 'present' });
    }
    const existing = new Map((await db.all('SELECT id, student_id, marks, status FROM marks WHERE test_id = $1', [id])).map((m) => [m.student_id, m]));
    const changes = [];
    for (const [sid, nv] of next) {
      const old = existing.get(sid) || null;
      const same = (!old && !nv) || (old && nv && old.status === nv.status && old.marks === nv.marks);
      if (!same) changes.push({ sid, old, nv });
    }
    await db.tx(async (c) => {
      for (const ch of changes) {
        if (ch.nv && ch.old) await c.q('UPDATE marks SET marks = $1, status = $2, entered_by = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4', [ch.nv.marks, ch.nv.status, req.user.id, ch.old.id]);
        else if (ch.nv) await c.q('INSERT INTO marks (test_id, student_id, marks, status, entered_by) VALUES ($1,$2,$3,$4,$5)', [id, ch.sid, ch.nv.marks, ch.nv.status, req.user.id]);
        else await c.q('DELETE FROM marks WHERE id = $1', [ch.old.id]);
        await c.q('INSERT INTO marks_history (test_id, student_id, old_marks, old_status, new_marks, new_status, changed_by, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [id, ch.sid, ch.old ? ch.old.marks : null, ch.old ? ch.old.status : null, ch.nv ? ch.nv.marks : null, ch.nv ? ch.nv.status : null, req.user.id, reason || null]);
      }
      if (lock && !t.marks_locked) {
        const missing = await c.one(
          `SELECT COUNT(*) AS n FROM student_class_history h JOIN students s ON s.id = h.student_id
           WHERE h.class_id = $1 AND h.session_id = $2 AND h.status = 'active' AND s.active = true
             AND NOT EXISTS (SELECT 1 FROM marks m WHERE m.test_id = $3 AND m.student_id = s.id)`, [t.class_id, t.session_id, id]);
        if (missing.n > 0) throw new HttpError(400, `${missing.n} विद्यार्थियों के अंक या अनुपस्थिति बाकी है। सबकी एंट्री पूरी करके फिर लॉक करें`);
        await c.q("UPDATE tests SET marks_locked = true, status = 'Completed', locked_by = $1, locked_at = CURRENT_TIMESTAMP WHERE id = $2", [req.user.id, id]);
      }
    });
    const action = t.marks_locked ? 'marks_correct' : lock ? 'marks_lock' : 'marks_save';
    await audit(req, action, 'test', t.test_code, { changed: changes.length, reason: reason || undefined });
    res.json({ saved: changes.length, locked: !!(t.marks_locked || lock) });
  });

  app.post('/api/tests/:id/unlock', admin, async (req, res) => {
    const id = asInt(req.params.id);
    const t = await getTest(id);
    const reason = String(req.body.reason || '').trim();
    if (!reason) throw new HttpError(400, 'अनलॉक का कारण लिखें');
    if (!t.marks_locked) throw new HttpError(400, 'अंक पहले से अनलॉक हैं');
    await db.q("UPDATE tests SET marks_locked = false, status = 'Scheduled', locked_by = NULL, locked_at = NULL WHERE id = $1", [id]);
    await audit(req, 'marks_unlock', 'test', t.test_code, { reason });
    res.json({ ok: true });
  });

  app.get('/api/tests/:id/history', staff, async (req, res) => {
    const t = await getTest(asInt(req.params.id));
    await assertStaffTest(req.user, t);
    res.json({ history: await db.all(
      `SELECT mh.id, mh.changed_at, mh.old_marks, mh.old_status, mh.new_marks, mh.new_status, mh.reason, s.name AS student, s.student_code AS code, u.full_name AS changed_by
       FROM marks_history mh JOIN students s ON s.id = mh.student_id LEFT JOIN users u ON u.id = mh.changed_by
       WHERE mh.test_id = $1 ORDER BY mh.id DESC LIMIT 500`, [t.id]) });
  });

  // ---------- Master Calendar import / export ----------
  app.post('/api/calendar/import', admin, async (req, res) => {
    const b64 = String(req.body.data || '');
    if (!b64) throw new HttpError(400, 'फ़ाइल नहीं मिली');
    let matrix;
    try { matrix = await readMatrix(Buffer.from(b64, 'base64'), 'Master Calendar'); } catch (_) { throw new HttpError(400, 'Excel (.xlsx) फ़ाइल पढ़ी नहीं जा सकी'); }
    const holidays = await db.all('SELECT start_date, end_date, note FROM holidays');
    const parsed = normalizeCalendarRows(matrix, { holidays });
    if (parsed.errors.length) return res.json({ error: 'कैलेंडर फ़ाइल में त्रुटियाँ हैं', errors: parsed.errors.slice(0, 100) }, 400);
    const sess = await currentSession();
    const out = await applyCalendar(parsed.rows, sess.id);
    if (!out.ok) return res.json({ error: 'कैलेंडर लागू नहीं हो सका', errors: out.errors.slice(0, 100) }, 400);
    await audit(req, 'calendar_import', 'test', null, { inserted: out.inserted, updated: out.updated, filename: req.body.filename || null });
    res.json({ inserted: out.inserted, updated: out.updated, warnings: parsed.warnings.concat(out.warnings).slice(0, 100) });
  });

  app.get('/api/calendar/export', admin, async (req, res) => {
    const sess = await currentSession();
    const rows = await db.all(`${TEST_SELECT} WHERE t.session_id = $1 ORDER BY t.test_date, c.grade, t.test_no`, [sess.id]);
    await sendTable(res, req.query.format || 'xlsx', 'master_calendar_' + sess.name, {
      title: 'Master Calendar',
      columns: ['Test ID', 'Date', 'Class', 'Subject', 'Test Number', 'Test Type', 'Syllabus/Chapters', 'Maximum Marks', 'Duration (min)', 'Status', 'Marks Locked'],
      rows: rows.map((t) => [t.test_code, t.test_date, t.grade, t.subject_name, t.test_no, t.test_type, t.syllabus, t.max_marks, t.duration_min, t.status, t.marks_locked ? 'Yes' : 'No']),
    });
  });

  // ---------- student: own tests ----------
  app.get('/api/my/tests', A.requireRole('student'), async (req, res) => {
    const sess = await currentSession();
    const enr = await db.one("SELECT class_id FROM student_class_history WHERE student_id = $1 AND session_id = $2 AND status = 'active'", [req.user.student_id, sess.id]);
    if (!enr) return res.json({ tests: [], today: todayStr() });
    const rows = await db.all(
      `SELECT t.id, t.test_code, t.test_no, t.test_date, t.test_type, t.syllabus, t.max_marks, t.duration_min, t.status, t.marks_locked, sb.name AS subject_name, m.marks, m.status AS mark_status
       FROM tests t JOIN subjects sb ON sb.id = t.subject_id LEFT JOIN marks m ON m.test_id = t.id AND m.student_id = $1
       WHERE t.class_id = $2 AND t.session_id = $3 ORDER BY t.test_date, t.test_no`, [req.user.student_id, enr.class_id, sess.id]);
    res.json({ today: todayStr(), tests: rows.map((r) => {
      const show = !!r.marks_locked;
      return { ...r, marks: show ? r.marks : null, mark_status: show ? r.mark_status : null,
        pct: show && r.mark_status === 'present' && r.max_marks > 0 ? Math.round((r.marks / r.max_marks) * 1000) / 10 : null };
    }) });
  });
};
module.exports.TEST_SELECT = TEST_SELECT;
