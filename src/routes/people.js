'use strict';
// Classes, subjects, students (CRUD, promotion, Excel import/export), teachers, user passwords.
const db = require('../db');
const { HttpError } = require('../http');
const A = require('../auth');
const { audit, currentSession, teacherSubjects, sendTable } = require('../core');
const { asInt, inList, randomPassword, toYmd, todayStr } = require('../util');
const { createStudent } = require('../people');
const { validateStudents } = require('../importer');
const { readMatrix, toXlsx } = require('../excel');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const HEAD6 = ['Roll No.', 'Student Name', 'Father Name', 'Mother Name', 'DOB', 'Gender'];

async function assertClass(id) {
  const c = await db.one('SELECT id, grade, name FROM classes WHERE id = $1', [id]);
  if (!c) throw new HttpError(400, 'कक्षा नहीं मिली');
  return c;
}
async function assertRollFree(sessionId, classId, roll, exceptStudent) {
  const params = [sessionId, classId, roll];
  let sql = "SELECT student_id FROM student_class_history WHERE session_id = $1 AND class_id = $2 AND roll_no = $3 AND status = 'active'";
  if (exceptStudent) { sql += ' AND student_id <> $4'; params.push(exceptStudent); }
  if (await db.one(sql, params)) throw new HttpError(409, `रोल नं. ${roll} इस कक्षा में पहले से है`);
}
function cleanStudent(b) {
  const name = String(b.name || '').trim().replace(/\s+/g, ' ');
  if (!name) throw new HttpError(400, 'नाम खाली है');
  if (name.length > 100) throw new HttpError(400, 'नाम बहुत लंबा है');
  let dob = null;
  if (b.dob) {
    dob = toYmd(b.dob);
    if (!dob || dob >= todayStr()) throw new HttpError(400, 'जन्मतिथि सही नहीं है');
  }
  const g = String(b.gender || '').toUpperCase();
  if (g && !['M', 'F', 'O'].includes(g)) throw new HttpError(400, 'लिंग M / F / O में से चुनें');
  return { name, father_name: String(b.father_name || '').trim() || null, mother_name: String(b.mother_name || '').trim() || null, dob, gender: g || null };
}
async function listStudents({ sessionId, classIds, q, includeInactive }) {
  const params = [sessionId];
  let where = "h.session_id = $1 AND h.status = 'active'";
  if (classIds) {
    if (!classIds.length) return [];
    where += ` AND h.class_id IN (${inList(classIds, 2)})`;
    params.push(...classIds);
  }
  if (q) {
    params.push('%' + q.toLowerCase() + '%');
    const n = params.length;
    where += ` AND (LOWER(s.name) LIKE $${n} OR LOWER(s.student_code) LIKE $${n} OR CAST(h.roll_no AS TEXT) LIKE $${n})`;
  }
  if (!includeInactive) where += ' AND s.active = true';
  return db.all(
    `SELECT s.id, s.student_code AS code, s.user_id, s.name, s.father_name, s.mother_name, s.dob, s.gender, s.active, s.is_demo, u.username,
            h.class_id, c.grade, c.name AS class_name, h.roll_no
     FROM students s JOIN student_class_history h ON h.student_id = s.id JOIN classes c ON c.id = h.class_id LEFT JOIN users u ON u.id = s.user_id
     WHERE ${where} ORDER BY c.grade, h.roll_no`, params);
}
async function chunked(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

module.exports = function register(app) {
  const admin = A.requireRole('admin');
  const staff = A.requireRole('admin', 'teacher');

  // ---------- classes & subjects ----------
  app.get('/api/classes', staff, async (req, res) => {
    const sess = await currentSession();
    let rows = await db.all(
      `SELECT c.id, c.grade, c.name,
        (SELECT COUNT(*) FROM student_class_history h JOIN students s ON s.id = h.student_id WHERE h.class_id = c.id AND h.session_id = $1 AND h.status = 'active' AND s.active = true) AS students,
        (SELECT COUNT(*) FROM subjects sb WHERE sb.class_id = c.id) AS subjects
       FROM classes c ORDER BY c.grade`, [sess.id]);
    if (req.user.role === 'teacher') {
      const mine = new Set((await teacherSubjects(req.user)).map((s) => s.class_id));
      rows = rows.filter((r) => mine.has(r.id));
    }
    res.json({ classes: rows });
  });
  app.post('/api/classes', admin, async (req, res) => {
    const grade = asInt(req.body.grade, 'कक्षा संख्या');
    const name = String(req.body.name || '').trim() || `कक्षा ${grade}`;
    if (grade < 1 || grade > 12) throw new HttpError(400, 'कक्षा 1 से 12 के बीच होनी चाहिए');
    const row = await db.one('INSERT INTO classes (grade, name) VALUES ($1,$2) RETURNING id', [grade, name]);
    await audit(req, 'class_add', 'class', row.id, { grade, name });
    res.json({ id: row.id }, 201);
  });
  app.get('/api/subjects', staff, async (req, res) => {
    const sess = await currentSession();
    const params = [sess.id];
    let where = '1 = 1';
    if (req.query.class_id) { params.push(asInt(req.query.class_id, 'class_id')); where += ` AND sb.class_id = $${params.length}`; }
    let rows = await db.all(
      `SELECT sb.id, sb.name, sb.class_id, c.grade, c.name AS class_name,
        (SELECT COUNT(*) FROM chapters ch WHERE ch.subject_id = sb.id) AS chapters,
        (SELECT COUNT(*) FROM tests t WHERE t.subject_id = sb.id AND t.session_id = $1) AS tests
       FROM subjects sb JOIN classes c ON c.id = sb.class_id WHERE ${where} ORDER BY c.grade, sb.id`, params);
    if (req.user.role === 'teacher') {
      const mine = new Set((await teacherSubjects(req.user)).map((s) => s.subject_id));
      rows = rows.filter((r) => mine.has(r.id));
    }
    res.json({ subjects: rows });
  });
  app.post('/api/subjects', admin, async (req, res) => {
    const classId = asInt(req.body.class_id, 'कक्षा');
    await assertClass(classId);
    const name = String(req.body.name || '').trim();
    if (!name) throw new HttpError(400, 'विषय का नाम लिखें');
    const row = await db.one('INSERT INTO subjects (class_id, name) VALUES ($1,$2) RETURNING id', [classId, name]);
    await audit(req, 'subject_add', 'subject', row.id, { class_id: classId, name });
    res.json({ id: row.id }, 201);
  });
  app.get('/api/subjects/:id/chapters', staff, async (req, res) => {
    const id = asInt(req.params.id);
    if (req.user.role === 'teacher' && !(await teacherSubjects(req.user)).some((s) => s.subject_id === id)) throw new HttpError(403, 'यह विषय आपको नहीं सौंपा गया');
    res.json({ chapters: await db.all('SELECT id, chapter_no, title FROM chapters WHERE subject_id = $1 ORDER BY chapter_no', [id]) });
  });

  // ---------- students ----------
  app.get('/api/students', staff, async (req, res) => {
    const sessionId = req.query.session_id ? asInt(req.query.session_id, 'session_id') : (await currentSession()).id;
    let classIds = req.query.class_id ? [asInt(req.query.class_id, 'class_id')] : null;
    if (req.user.role === 'teacher') {
      const mine = [...new Set((await teacherSubjects(req.user)).map((s) => s.class_id))];
      classIds = classIds ? classIds.filter((c) => mine.includes(c)) : mine;
    }
    let rows = await listStudents({ sessionId, classIds, q: String(req.query.q || '').trim(), includeInactive: req.query.inactive === '1' && req.user.role === 'admin' });
    if (req.user.role === 'teacher') rows = rows.map((r) => ({ id: r.id, code: r.code, name: r.name, class_id: r.class_id, grade: r.grade, class_name: r.class_name, roll_no: r.roll_no, active: r.active }));
    res.json({ students: rows });
  });

  app.post('/api/students', admin, async (req, res) => {
    const sess = await currentSession();
    const f = cleanStudent(req.body);
    const classId = asInt(req.body.class_id, 'कक्षा');
    const roll = asInt(req.body.roll_no, 'रोल नं.');
    if (roll < 1) throw new HttpError(400, 'रोल नं. 1 या उससे ज़्यादा हो');
    await assertClass(classId);
    await assertRollFree(sess.id, classId, roll);
    const out = await db.tx((c) => createStudent(c, { ...f, class_id: classId, roll_no: roll, session_id: sess.id }));
    await audit(req, 'student_add', 'student', out.id, { name: f.name, class_id: classId, roll_no: roll });
    res.json({ student_id: out.id, credentials: { student_code: out.code, username: out.username, password: out.password } }, 201);
  });

  app.put('/api/students/:id', admin, async (req, res) => {
    const id = asInt(req.params.id);
    const sess = await currentSession();
    const cur = await db.one(
      `SELECT s.id, s.user_id, s.name, h.id AS hid, h.class_id, h.roll_no FROM students s
       JOIN student_class_history h ON h.student_id = s.id AND h.session_id = $2 WHERE s.id = $1`, [id, sess.id]);
    if (!cur) throw new HttpError(404, 'विद्यार्थी नहीं मिला');
    const f = cleanStudent(req.body);
    const classId = req.body.class_id ? asInt(req.body.class_id, 'कक्षा') : cur.class_id;
    const roll = req.body.roll_no ? asInt(req.body.roll_no, 'रोल नं.') : cur.roll_no;
    if (roll < 1) throw new HttpError(400, 'रोल नं. 1 या उससे ज़्यादा हो');
    if (classId !== cur.class_id || roll !== cur.roll_no) {
      await assertClass(classId);
      await assertRollFree(sess.id, classId, roll, id);
    }
    if (classId !== cur.class_id && (await db.one('SELECT m.id FROM marks m JOIN tests t ON t.id = m.test_id WHERE m.student_id = $1 AND t.session_id = $2 LIMIT 1', [id, sess.id]))) {
      throw new HttpError(400, 'इस विद्यार्थी के अंक दर्ज हैं, इसलिए सत्र के बीच में कक्षा नहीं बदली जा सकती');
    }
    await db.tx(async (c) => {
      await c.q('UPDATE students SET name = $1, father_name = $2, mother_name = $3, dob = $4, gender = $5 WHERE id = $6', [f.name, f.father_name, f.mother_name, f.dob, f.gender, id]);
      if (cur.user_id) await c.q('UPDATE users SET full_name = $1 WHERE id = $2', [f.name, cur.user_id]);
      await c.q('UPDATE student_class_history SET class_id = $1, roll_no = $2 WHERE id = $3', [classId, roll, cur.hid]);
    });
    await audit(req, 'student_edit', 'student', id, { before: { name: cur.name, class_id: cur.class_id, roll_no: cur.roll_no }, after: { name: f.name, class_id: classId, roll_no: roll } });
    res.json({ ok: true });
  });

  app.patch('/api/students/:id/active', admin, async (req, res) => {
    const id = asInt(req.params.id);
    const active = !!req.body.active;
    const st = await db.one('SELECT id, user_id FROM students WHERE id = $1', [id]);
    if (!st) throw new HttpError(404, 'विद्यार्थी नहीं मिला');
    await db.q('UPDATE students SET active = $1 WHERE id = $2', [active, id]);
    if (st.user_id) await db.q('UPDATE users SET active = $1 WHERE id = $2', [active, st.user_id]);
    await audit(req, active ? 'student_activate' : 'student_deactivate', 'student', id);
    res.json({ ok: true });
  });

  app.get('/api/students/:id/history', admin, async (req, res) => {
    const id = asInt(req.params.id);
    res.json({ history: await db.all(
      `SELECT h.id, ss.name AS session, c.grade, c.name AS class_name, h.roll_no, h.status FROM student_class_history h
       JOIN sessions ss ON ss.id = h.session_id JOIN classes c ON c.id = h.class_id WHERE h.student_id = $1 ORDER BY ss.id`, [id]) });
  });

  app.post('/api/students/promote', admin, async (req, res) => {
    const toSession = asInt(req.body.to_session_id, 'सत्र');
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length) throw new HttpError(400, 'कोई विद्यार्थी चुना नहीं गया');
    if (!(await db.one('SELECT id FROM sessions WHERE id = $1', [toSession]))) throw new HttpError(400, 'सत्र नहीं मिला');
    const seen = new Set();
    const clean = [];
    for (const it of items) {
      const o = { student_id: asInt(it.student_id, 'विद्यार्थी'), class_id: asInt(it.class_id, 'कक्षा'), roll_no: asInt(it.roll_no, 'रोल नं.') };
      if (o.roll_no < 1) throw new HttpError(400, 'रोल नं. 1 या उससे ज़्यादा हो');
      const k = `${o.class_id}|${o.roll_no}`;
      if (seen.has(k)) throw new HttpError(400, `रोल नं. ${o.roll_no} दोबारा आया है`);
      seen.add(k);
      clean.push(o);
    }
    for (const o of clean) {
      await assertClass(o.class_id);
      await assertRollFree(toSession, o.class_id, o.roll_no);
      const st = await db.one('SELECT id, active FROM students WHERE id = $1', [o.student_id]);
      if (!st || !st.active) throw new HttpError(400, 'कोई विद्यार्थी नहीं मिला या निष्क्रिय है');
      if (await db.one('SELECT id FROM student_class_history WHERE student_id = $1 AND session_id = $2', [o.student_id, toSession])) throw new HttpError(409, 'कुछ विद्यार्थी इस सत्र में पहले से हैं');
    }
    await db.tx(async (c) => {
      for (const o of clean) await c.q("INSERT INTO student_class_history (student_id, session_id, class_id, roll_no, status) VALUES ($1,$2,$3,$4,'active')", [o.student_id, toSession, o.class_id, o.roll_no]);
    });
    await audit(req, 'students_promote', 'session', toSession, { count: clean.length });
    res.json({ promoted: clean.length });
  });

  app.get('/api/students/export', admin, async (req, res) => {
    const sess = await currentSession();
    const rows = await listStudents({ sessionId: sess.id, classIds: req.query.class_id ? [asInt(req.query.class_id, 'class_id')] : null, q: '', includeInactive: true });
    await audit(req, 'students_export', 'student', null, { count: rows.length });
    await sendTable(res, req.query.format || 'xlsx', 'students_' + sess.name, {
      title: 'Students',
      columns: ['Student ID', 'Class', 'Roll No.', 'Student Name', 'Father Name', 'Mother Name', 'DOB', 'Gender', 'Username', 'Active'],
      rows: rows.map((r) => [r.code, r.class_name, r.roll_no, r.name, r.father_name || '', r.mother_name || '', r.dob || '', r.gender || '', r.username || '', r.active ? 'Yes' : 'No']),
    });
  });

  // ---------- Excel import ----------
  app.get('/api/import/template', admin, async (req, res) => {
    const help = [
      ['1. "Students" शीट में अपने विद्यार्थियों की जानकारी भरें (हेडर पंक्ति न बदलें)।'],
      ['2. Roll No. और Student Name ज़रूरी हैं। बाकी कॉलम खाली छोड़ सकते हैं।'],
      ['3. DOB का फ़ॉर्मैट YYYY-MM-DD या DD-MM-YYYY रखें। Gender: M या F।'],
      ['4. एक फ़ाइल में एक ही कक्षा के विद्यार्थी रखें; कक्षा वेबसाइट पर चुनी जाती है।'],
      ['5. "उदाहरण" शीट सिर्फ़ समझने के लिए है, वह अपलोड नहीं होती।'],
    ];
    const buf = await toXlsx('Students', HEAD6, [], [
      { name: 'निर्देश', columns: ['निर्देश'], rows: help },
      { name: 'उदाहरण', columns: HEAD6, rows: [[1, 'राम कुमार', 'श्याम कुमार', 'सीता देवी', '2015-06-15', 'M']] },
    ]);
    res.send(buf, XLSX_MIME, 200, { 'Content-Disposition': 'attachment; filename="student_import_template.xlsx"' });
  });

  app.post('/api/import/preview', admin, async (req, res) => {
    const classId = asInt(req.body.class_id, 'कक्षा');
    await assertClass(classId);
    const b64 = String(req.body.data || '');
    if (!b64) throw new HttpError(400, 'फ़ाइल नहीं मिली');
    let matrix;
    try { matrix = await readMatrix(Buffer.from(b64, 'base64'), 'Students'); } catch (_) { throw new HttpError(400, 'Excel (.xlsx) फ़ाइल पढ़ी नहीं जा सकी। टेम्पलेट वाली .xlsx फ़ाइल अपलोड करें'); }
    const sess = await currentSession();
    const existing = new Set((await db.all("SELECT roll_no FROM student_class_history WHERE session_id = $1 AND class_id = $2 AND status = 'active'", [sess.id, classId])).map((r) => r.roll_no));
    const v = validateStudents(matrix, existing);
    if (v.summary.total === 0) throw new HttpError(400, 'फ़ाइल में कोई विद्यार्थी नहीं मिला');
    if (v.summary.total > 1000) throw new HttpError(400, 'एक बार में अधिकतम 1000 विद्यार्थी अपलोड करें');
    const imp = await db.one(
      'INSERT INTO student_imports (uploaded_by, class_id, filename, total_rows, valid_rows, invalid_rows, status, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [req.user.id, classId, String(req.body.filename || '').slice(0, 200), v.summary.total, v.summary.valid, v.summary.invalid, 'preview', JSON.stringify(v.valid)]);
    for (const e of v.errors.slice(0, 500)) await db.q('INSERT INTO student_import_errors (import_id, row_no, message) VALUES ($1,$2,$3)', [imp.id, e.row, e.message]);
    await audit(req, 'import_preview', 'import', imp.id, v.summary);
    res.json({ import_id: imp.id, summary: v.summary, errors: v.errors.slice(0, 500), sample: v.valid.slice(0, 15) });
  });

  app.post('/api/import/:id/confirm', admin, async (req, res) => {
    const id = asInt(req.params.id);
    const imp = await db.one('SELECT id, class_id, status, payload FROM student_imports WHERE id = $1', [id]);
    if (!imp) throw new HttpError(404, 'इम्पोर्ट नहीं मिला');
    if (imp.status !== 'preview') throw new HttpError(400, 'यह इम्पोर्ट पहले ही हो चुका है');
    const rows = JSON.parse(imp.payload || '[]');
    if (!rows.length) throw new HttpError(400, 'जोड़ने के लिए कोई सही रिकॉर्ड नहीं है');
    const sess = await currentSession();
    const existing = new Set((await db.all("SELECT roll_no FROM student_class_history WHERE session_id = $1 AND class_id = $2 AND status = 'active'", [sess.id, imp.class_id])).map((r) => r.roll_no));
    if (rows.some((r) => existing.has(r.roll_no))) throw new HttpError(409, 'कुछ रोल नं. अब पहले से मौजूद हैं। फ़ाइल दोबारा अपलोड करें');
    const prepared = await chunked(rows, 8, async (r) => { const password = randomPassword(8); return { ...r, password, hash: await A.hashPassword(password) }; });
    const cls = await assertClass(imp.class_id);
    const created = await db.tx(async (c) => {
      const out = [];
      for (const r of prepared) {
        const s = await createStudent(c, { ...r, class_id: imp.class_id, session_id: sess.id });
        out.push({ student_code: s.code, class: cls.name, roll_no: r.roll_no, name: r.name, username: s.username, password: s.password });
      }
      await c.q("UPDATE student_imports SET status = 'done' WHERE id = $1", [id]);
      return out;
    });
    await audit(req, 'import_confirm', 'import', id, { created: created.length, class_id: imp.class_id });
    res.json({ created: created.length, credentials: created });
  });

  // ---------- teachers ----------
  app.get('/api/teachers', admin, async (req, res) => {
    const ts = await db.all(
      `SELECT t.id, t.phone, t.email, u.id AS user_id, u.username, u.full_name, u.active, u.last_login, u.is_demo
       FROM teachers t JOIN users u ON u.id = t.user_id ORDER BY u.full_name`);
    const as = await db.all(
      `SELECT ta.teacher_id, sb.id AS subject_id, sb.name AS subject, c.grade, c.name AS class_name
       FROM teacher_assignments ta JOIN subjects sb ON sb.id = ta.subject_id JOIN classes c ON c.id = sb.class_id ORDER BY c.grade, sb.name`);
    res.json({ teachers: ts.map((t) => ({ ...t, assignments: as.filter((a) => a.teacher_id === t.id) })) });
  });
  app.post('/api/teachers', admin, async (req, res) => {
    const full = String(req.body.full_name || '').trim();
    const username = String(req.body.username || '').trim().toLowerCase();
    if (!full) throw new HttpError(400, 'शिक्षक का नाम लिखें');
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw new HttpError(400, 'यूज़रनेम 3-30 अक्षरों का हो (a-z, 0-9, . _ -)');
    if (await db.one('SELECT id FROM users WHERE username = $1', [username])) throw new HttpError(409, 'यह यूज़रनेम पहले से है');
    const password = randomPassword(8);
    const hash = await A.hashPassword(password);
    const t = await db.tx(async (c) => {
      const u = await c.one("INSERT INTO users (username, password_hash, role, full_name, must_change_password) VALUES ($1,$2,'teacher',$3,true) RETURNING id", [username, hash, full]);
      return c.one('INSERT INTO teachers (user_id, phone, email) VALUES ($1,$2,$3) RETURNING id', [u.id, String(req.body.phone || '').trim() || null, String(req.body.email || '').trim() || null]);
    });
    await audit(req, 'teacher_add', 'teacher', t.id, { username, full_name: full });
    res.json({ teacher_id: t.id, credentials: { username, password } }, 201);
  });
  app.put('/api/teachers/:id', admin, async (req, res) => {
    const id = asInt(req.params.id);
    const t = await db.one('SELECT id, user_id FROM teachers WHERE id = $1', [id]);
    if (!t) throw new HttpError(404, 'शिक्षक नहीं मिला');
    const full = String(req.body.full_name || '').trim();
    if (!full) throw new HttpError(400, 'शिक्षक का नाम लिखें');
    await db.tx(async (c) => {
      await c.q('UPDATE users SET full_name = $1, active = $2 WHERE id = $3', [full, req.body.active !== false, t.user_id]);
      await c.q('UPDATE teachers SET phone = $1, email = $2 WHERE id = $3', [String(req.body.phone || '').trim() || null, String(req.body.email || '').trim() || null, id]);
    });
    await audit(req, 'teacher_edit', 'teacher', id, { full_name: full, active: req.body.active !== false });
    res.json({ ok: true });
  });
  app.put('/api/teachers/:id/assignments', admin, async (req, res) => {
    const id = asInt(req.params.id);
    if (!(await db.one('SELECT id FROM teachers WHERE id = $1', [id]))) throw new HttpError(404, 'शिक्षक नहीं मिला');
    const ids = [...new Set((Array.isArray(req.body.subject_ids) ? req.body.subject_ids : []).map((x) => asInt(x, 'विषय')))];
    if (ids.length && (await db.all(`SELECT id FROM subjects WHERE id IN (${inList(ids)})`, ids)).length !== ids.length) throw new HttpError(400, 'कोई विषय नहीं मिला');
    await db.tx(async (c) => {
      await c.q('DELETE FROM teacher_assignments WHERE teacher_id = $1', [id]);
      for (const sid of ids) await c.q('INSERT INTO teacher_assignments (teacher_id, subject_id) VALUES ($1,$2)', [id, sid]);
    });
    await audit(req, 'teacher_assign', 'teacher', id, { subject_ids: ids });
    res.json({ ok: true, count: ids.length });
  });
  app.post('/api/users/:id/reset-password', admin, async (req, res) => {
    const id = asInt(req.params.id);
    const u = await db.one('SELECT id, username, role FROM users WHERE id = $1', [id]);
    if (!u) throw new HttpError(404, 'उपयोगकर्ता नहीं मिला');
    const password = randomPassword(8);
    await db.q('UPDATE users SET password_hash = $1, must_change_password = true WHERE id = $2', [await A.hashPassword(password), id]);
    await audit(req, 'password_reset', 'user', id, { username: u.username });
    res.json({ username: u.username, password });
  });

  // teacher's own classes/subjects with progress counters
  app.get('/api/me/teacher', A.requireRole('teacher'), async (req, res) => {
    const sess = await currentSession();
    const subs = await teacherSubjects(req.user);
    if (!subs.length) return res.json({ subjects: [] });
    const ids = subs.map((s) => s.subject_id);
    const stats = await db.all(
      `SELECT t.subject_id, COUNT(*) AS total,
         SUM(CASE WHEN t.marks_locked = true THEN 1 ELSE 0 END) AS locked,
         SUM(CASE WHEN t.marks_locked = false AND t.test_date <= $2 AND t.status IN ('Scheduled','Completed') THEN 1 ELSE 0 END) AS pending
       FROM tests t WHERE t.session_id = $1 AND t.subject_id IN (${inList(ids, 3)}) GROUP BY t.subject_id`, [sess.id, todayStr(), ...ids]);
    const counts = await db.all(
      `SELECT h.class_id, COUNT(*) AS n FROM student_class_history h JOIN students s ON s.id = h.student_id
       WHERE h.session_id = $1 AND h.status = 'active' AND s.active = true GROUP BY h.class_id`, [sess.id]);
    res.json({ subjects: subs.map((s) => {
      const st = stats.find((x) => x.subject_id === s.subject_id) || {};
      const cn = counts.find((x) => x.class_id === s.class_id) || {};
      return { ...s, students: cn.n || 0, tests: st.total || 0, locked: st.locked || 0, pending: st.pending || 0 };
    }) });
  });
};
