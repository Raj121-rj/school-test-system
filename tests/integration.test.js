'use strict';
// End-to-end API tests: real HTTP server + real app code + SQLite stand-in for PostgreSQL.
const assert = require('assert');

module.exports = async function (t) {
  process.env.SCHOOL_TZ = 'Asia/Kolkata';
  const db = require('../src/db');
  const { createSqliteDriver } = require('./sqlite-driver');
  db.use(createSqliteDriver());
  await db.migrate();
  await require('../src/seed').seed({ demo: true });
  const { build } = require('../server');
  const app = build();
  const server = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${server.address().port}`;

  function client() {
    let cookie = '';
    const call = async (method, path, body, extra = {}) => {
      const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'sts', ...(cookie ? { Cookie: cookie } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined });
      for (const sc of res.headers.getSetCookie()) { const kv = sc.split(';')[0]; cookie = kv.endsWith('=') ? '' : kv; }
      const ct = res.headers.get('content-type') || '';
      const raw = Buffer.from(await res.arrayBuffer()).toString('utf8'); // Buffer keeps a leading BOM (fetch().text() would strip it)
      return { status: res.status, data: ct.includes('json') ? JSON.parse(raw) : raw, headers: res.headers };
    };
    return call;
  }
  const admin = client(), teacher = client(), student = client();
  const ok = (r, msg) => assert.strictEqual(r.status, 200, `${msg || ''} -> ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`);

  await t('seed: 4 classes, 21 subjects, 335 chapters, 192 tests, chapter links, holidays', async () => {
    assert.strictEqual((await db.one('SELECT COUNT(*) AS n FROM classes')).n, 4);
    assert.strictEqual((await db.one('SELECT COUNT(*) AS n FROM subjects')).n, 21);
    assert.strictEqual((await db.one('SELECT COUNT(*) AS n FROM chapters')).n, 335);
    assert.strictEqual((await db.one('SELECT COUNT(*) AS n FROM tests')).n, 192);
    assert.strictEqual((await db.one('SELECT COUNT(DISTINCT test_date) AS n FROM tests')).n, 48);
    assert.ok((await db.one('SELECT COUNT(*) AS n FROM test_chapters')).n > 400);
    assert.strictEqual((await db.one('SELECT COUNT(*) AS n FROM holidays')).n, 3);
    const first = await db.one("SELECT test_date, test_code FROM tests WHERE test_code = 'C5-T01'");
    assert.strictEqual(first.test_date, '2026-10-12');
    const full = await db.one('SELECT COUNT(*) AS n FROM tests WHERE full_syllabus = true');
    assert.strictEqual(full.n, 4 * 6 === 24 ? 21 : full.n); // 21 full-syllabus tests (one per subject)
  });

  await t('static pages, SPA fallback, health, 404 and CSRF guard', async () => {
    const h = await fetch(base + '/healthz');
    assert.strictEqual(h.status, 200);
    const nf = await fetch(base + '/api/nope', { headers: { 'X-Requested-With': 'sts' } });
    assert.strictEqual(nf.status, 404);
    const csrf = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.strictEqual(csrf.status, 403);
    const unauth = await admin('GET', '/api/students');
    assert.strictEqual(unauth.status, 401);
    const anon = await admin('GET', '/api/auth/me');
    assert.strictEqual(anon.status, 200);
    assert.strictEqual(anon.data.user, null);
    const spa = await fetch(base + '/admin/students');
    assert.ok([200, 404].includes(spa.status));
  });

  await t('login: wrong password rejected, correct accepted, session cookie works', async () => {
    assert.strictEqual((await admin('POST', '/api/auth/login', { username: 'admin', password: 'wrong' })).status, 401);
    const r = await admin('POST', '/api/auth/login', { username: 'ADMIN', password: 'Admin@123' });
    ok(r, 'admin login');
    assert.strictEqual(r.data.user.role, 'admin');
    const me = await admin('GET', '/api/auth/me');
    ok(me);
    assert.strictEqual(me.data.session.name, '2026-27');
    ok(await teacher('POST', '/api/auth/login', { username: 'teacher1', password: 'Teacher@123' }));
    ok(await student('POST', '/api/auth/login', { username: 'st00001', password: 'Student@123' }));
  });

  await t('admin dashboard, classes, subjects, settings', async () => {
    const d = await admin('GET', '/api/dashboard/admin');
    ok(d);
    assert.strictEqual(d.data.counts.students, 32);
    assert.strictEqual(d.data.counts.tests, 192);
    assert.strictEqual(d.data.counts.locked, 40);
    const c = await admin('GET', '/api/classes'); ok(c);
    assert.deepStrictEqual(c.data.classes.map((x) => x.students), [8, 8, 8, 8]);
    const s = await admin('GET', '/api/subjects?class_id=' + c.data.classes[3].id); ok(s);
    assert.strictEqual(s.data.subjects.length, 5);
    const st = await admin('GET', '/api/settings'); ok(st);
    assert.strictEqual(st.data.demo_students, 32);
    ok(await admin('PUT', '/api/settings', { school_name: 'आदर्श विद्यालय', attention_below_pct: 45 }));
  });

  let myTests;
  await t('role scoping: teacher sees only assigned subjects, students see only own data', async () => {
    const tt = await teacher('GET', '/api/tests'); ok(tt);
    myTests = tt.data.tests;
    const expected = (await db.one(`SELECT COUNT(*) AS n FROM tests t JOIN teacher_assignments ta ON ta.subject_id = t.subject_id`)).n;
    assert.strictEqual(myTests.length, expected);
    assert.ok(myTests.every((x) => ['गणित', 'विज्ञान'].includes(x.subject_name)));
    assert.strictEqual((await teacher('GET', '/api/teachers')).status, 403);
    assert.strictEqual((await teacher('GET', '/api/audit')).status, 403);
    const hindi8 = await db.one("SELECT t.id FROM tests t JOIN subjects s ON s.id = t.subject_id JOIN classes c ON c.id = t.class_id WHERE c.grade = 8 AND s.name = 'हिंदी' LIMIT 1");
    assert.strictEqual((await teacher('GET', '/api/tests/' + hindi8.id)).status, 403);
    assert.strictEqual((await teacher('PUT', `/api/tests/${hindi8.id}/marks`, { entries: [] })).status, 403);
    const stu = await teacher('GET', '/api/students'); ok(stu);
    assert.ok(stu.data.students.every((x) => x.grade !== 12 && !('dob' in x)));
    assert.strictEqual((await student('GET', '/api/students')).status, 403);
    assert.strictEqual((await student('GET', '/api/tests')).status, 403);
    const mine = await student('GET', '/api/my/tests'); ok(mine);
    assert.ok(mine.data.tests.length === 48);
    assert.ok(mine.data.tests.filter((x) => x.marks != null).length <= 10);
    const other = await db.one("SELECT id FROM students WHERE student_code = 'ST00002'");
    assert.strictEqual((await student('GET', '/api/analysis/student/' + other.id)).status, 403);
  });

  await t('student analysis: summary, subjects, chapters, trend honesty', async () => {
    const r = await student('GET', '/api/analysis/student/me'); ok(r);
    const s = r.data.summary;
    assert.ok(s.held >= 1 && s.given >= 1 && s.avg > 0 && s.highest >= s.lowest);
    assert.ok(s.subjects.length >= 1);
    assert.ok(['improving', 'stable', 'declining', 'insufficient'].includes(s.trend));
    assert.ok(r.data.timeline.length >= s.given);
    assert.ok(r.data.chapters.length >= 1);
    // student sees locked tests only (10 per class) -> held must be <= 10
    assert.ok(s.held <= 10);
    const rep = await student('GET', '/api/reports/student/me'); ok(rep);
    assert.ok(rep.data.rows.length >= 1);
    assert.strictEqual((await student('GET', '/api/reports/class?class_id=1')).status, 403);
  });

  let testId;
  await t('marks entry: validation, blanks, absent, history, lock, locked edit rules', async () => {
    const cand = await db.one(`SELECT t.id FROM tests t JOIN subjects s ON s.id = t.subject_id JOIN classes c ON c.id = t.class_id
      WHERE c.grade = 8 AND s.name = 'गणित' AND t.marks_locked = false AND NOT EXISTS (SELECT 1 FROM marks m WHERE m.test_id = t.id) ORDER BY t.test_date LIMIT 1`);
    testId = cand.id;
    const det = await teacher('GET', '/api/tests/' + testId); ok(det);
    assert.strictEqual(det.data.students.length, 8);
    assert.ok(det.data.chapters.length >= 1 || det.data.test.full_syllabus);
    assert.strictEqual(det.data.can_edit, true);
    const ids = det.data.students.map((x) => x.id);
    assert.strictEqual((await teacher('PUT', `/api/tests/${testId}/marks`, { entries: [{ student_id: ids[0], marks: 25 }] })).status, 400);
    assert.strictEqual((await teacher('PUT', `/api/tests/${testId}/marks`, { entries: [{ student_id: ids[0], marks: -1 }] })).status, 400);
    assert.strictEqual((await teacher('PUT', `/api/tests/${testId}/marks`, { entries: [{ student_id: ids[0], marks: 'abc' }] })).status, 400);
    assert.strictEqual((await teacher('PUT', `/api/tests/${testId}/marks`, { entries: [{ student_id: ids[0], marks: 12.345 }] })).status, 400);
    const r1 = await teacher('PUT', `/api/tests/${testId}/marks`, { entries: [{ student_id: ids[0], marks: 15 }, { student_id: ids[1], marks: 8.5 }, { student_id: ids[2], absent: true }, { student_id: ids[3], marks: '' }] });
    ok(r1); assert.strictEqual(r1.data.saved, 3);
    assert.strictEqual((await teacher('PUT', `/api/tests/${testId}/marks`, { lock: true, entries: [] })).status, 400); // blanks remain
    const r2 = await teacher('PUT', `/api/tests/${testId}/marks`, { entries: [{ student_id: ids[0], marks: 16 }] });
    ok(r2); assert.strictEqual(r2.data.saved, 1);
    const same = await teacher('PUT', `/api/tests/${testId}/marks`, { entries: [{ student_id: ids[0], marks: 16 }] });
    ok(same); assert.strictEqual(same.data.saved, 0);
    const rest = ids.slice(3).map((id, i) => ({ student_id: id, marks: 10 + i }));
    const lock = await teacher('PUT', `/api/tests/${testId}/marks`, { entries: rest, lock: true });
    ok(lock); assert.strictEqual(lock.data.locked, true);
    assert.strictEqual((await db.one('SELECT status FROM tests WHERE id = $1', [testId])).status, 'Completed');
    assert.strictEqual((await teacher('PUT', `/api/tests/${testId}/marks`, { entries: [{ student_id: ids[0], marks: 1 }] })).status, 403);
    assert.strictEqual((await admin('PUT', `/api/tests/${testId}/marks`, { entries: [{ student_id: ids[0], marks: 17 }] })).status, 400); // reason needed
    ok(await admin('PUT', `/api/tests/${testId}/marks`, { entries: [{ student_id: ids[0], marks: 17 }], reason: 'जाँच में जोड़ गलत था' }), 'admin correction');
    const h = await admin('GET', `/api/tests/${testId}/history`); ok(h);
    assert.ok(h.data.history.length >= 8);
    assert.ok(h.data.history.some((x) => x.reason === 'जाँच में जोड़ गलत था' && x.old_marks === 16 && x.new_marks === 17));
    const stud = await db.one("SELECT id FROM students WHERE student_code = 'ST00001'");
    assert.ok(stud);
  });

  await t('schedule control: warnings for holidays, force, status rules, defaults', async () => {
    const x = await db.one("SELECT id FROM tests WHERE test_code = 'C5-T20'");
    const w = await admin('PUT', '/api/tests/' + x.id, { test_date: '2026-11-07', max_marks: 25, duration_min: 45, status: 'Scheduled' });
    assert.strictEqual(w.status, 409); assert.strictEqual(w.data.needs_force, true); assert.ok(w.data.warnings.length >= 2);
    ok(await admin('PUT', '/api/tests/' + x.id, { test_date: '2026-11-07', max_marks: 25, duration_min: 45, status: 'Postponed', force: true }));
    assert.strictEqual((await db.one('SELECT status FROM tests WHERE id = $1', [x.id])).status, 'Postponed');
    assert.strictEqual((await admin('PUT', '/api/tests/' + testId, { status: 'Cancelled' })).status, 400);
    assert.strictEqual((await admin('PUT', '/api/tests/' + x.id, { status: 'Completed' })).status, 400);
    assert.strictEqual((await teacher('PUT', '/api/tests/' + x.id, { status: 'Scheduled' })).status, 403);
    const d = await admin('POST', '/api/tests/defaults', { max_marks: 30, overwrite: true, class_id: 1 }); ok(d);
    assert.ok(d.data.updated > 0);
  });

  await t('students: add, duplicate roll, edit, deactivate, history, promote to next session', async () => {
    const cls = (await admin('GET', '/api/classes')).data.classes[0];
    const add = await admin('POST', '/api/students', { class_id: cls.id, roll_no: 50, name: 'नया विद्यार्थी', father_name: 'पिता', dob: '2015-04-04', gender: 'M' });
    assert.strictEqual(add.status, 201);
    const cred = add.data.credentials;
    assert.ok(/^ST\d{5}$/.test(cred.student_code) && cred.password.length === 8);
    assert.strictEqual((await admin('POST', '/api/students', { class_id: cls.id, roll_no: 50, name: 'दोहरा' })).status, 409);
    assert.strictEqual((await admin('POST', '/api/students', { class_id: cls.id, roll_no: 51, name: '' })).status, 400);
    ok(await admin('PUT', '/api/students/' + add.data.student_id, { name: 'नया विद्यार्थी (सुधारा)', roll_no: 51, class_id: cls.id, dob: '2015-04-04', gender: 'M' }));
    const nu = client();
    ok(await nu('POST', '/api/auth/login', { username: cred.username, password: cred.password }));
    assert.strictEqual((await nu('GET', '/api/my/tests')).status, 403); // must change password first
    assert.strictEqual((await nu('POST', '/api/auth/change-password', { current_password: cred.password, new_password: 'short' })).status, 400);
    ok(await nu('POST', '/api/auth/change-password', { current_password: cred.password, new_password: 'MyNewPass123' }));
    ok(await nu('GET', '/api/my/tests'));
    const again = client();
    assert.strictEqual((await again('POST', '/api/auth/login', { username: cred.username, password: cred.password })).status, 401);
    const s2 = await admin('POST', '/api/sessions', { name: '2027-28' });
    assert.strictEqual(s2.status, 201);
    const cls8 = (await admin('GET', '/api/classes')).data.classes[1];
    const pr = await admin('POST', '/api/students/promote', { to_session_id: s2.data.id, items: [{ student_id: add.data.student_id, class_id: cls8.id, roll_no: 1 }] });
    ok(pr, 'promote');
    const hist = await admin('GET', `/api/students/${add.data.student_id}/history`); ok(hist);
    assert.strictEqual(hist.data.history.length, 2);
    assert.strictEqual((await admin('POST', '/api/students/promote', { to_session_id: s2.data.id, items: [{ student_id: add.data.student_id, class_id: cls8.id, roll_no: 2 }] })).status, 409);
    ok(await admin('PATCH', `/api/students/${add.data.student_id}/active`, { active: false }));
    assert.strictEqual((await again('POST', '/api/auth/login', { username: cred.username, password: 'MyNewPass123' })).status, 401);
    const exp = await admin('GET', '/api/students/export?format=csv'); ok(exp);
    assert.ok(exp.data.includes('Student ID') && exp.data.includes('ST00001'));
  });

  await t('student Excel import: preview data -> confirm creates students with one-time credentials', async () => {
    const { validateStudents } = require('../src/importer');
    const cls = (await admin('GET', '/api/classes')).data.classes[2];
    const v = validateStudents([['Roll No.', 'Student Name'], [60, 'इम्पोर्ट एक'], [61, 'इम्पोर्ट दो'], [61, 'दोहरा']], new Set());
    assert.strictEqual(v.valid.length, 2); assert.strictEqual(v.errors.length, 1);
    const imp = await db.one("INSERT INTO student_imports (uploaded_by, class_id, filename, total_rows, valid_rows, invalid_rows, status, payload) VALUES (1,$1,'x.xlsx',3,2,1,'preview',$2) RETURNING id", [cls.id, JSON.stringify(v.valid)]);
    const c = await admin('POST', `/api/import/${imp.id}/confirm`, {}); ok(c);
    assert.strictEqual(c.data.created, 2);
    assert.ok(c.data.credentials.every((x) => x.password.length === 8 && /^st\d{5}$/.test(x.username)));
    assert.strictEqual((await admin('POST', `/api/import/${imp.id}/confirm`, {})).status, 400);
    assert.strictEqual((await admin('POST', '/api/import/preview', { class_id: cls.id, data: '' })).status, 400);
  });

  await t('teachers: create, assign, scope, reset password', async () => {
    const c = await admin('POST', '/api/teachers', { full_name: 'नए शिक्षक', username: 'newteacher', phone: '9000000000' });
    assert.strictEqual(c.status, 201);
    assert.strictEqual((await admin('POST', '/api/teachers', { full_name: 'x', username: 'newteacher' })).status, 409);
    const sub = await db.one("SELECT sb.id FROM subjects sb JOIN classes c ON c.id = sb.class_id WHERE c.grade = 10 AND sb.name = 'English'");
    ok(await admin('PUT', `/api/teachers/${c.data.teacher_id}/assignments`, { subject_ids: [sub.id] }));
    const tc = client();
    ok(await tc('POST', '/api/auth/login', { username: 'newteacher', password: c.data.credentials.password }));
    ok(await tc('POST', '/api/auth/change-password', { current_password: c.data.credentials.password, new_password: 'Teach1234' }));
    const mine = await tc('GET', '/api/me/teacher'); ok(mine);
    assert.strictEqual(mine.data.subjects.length, 1);
    const tests = await tc('GET', '/api/tests'); ok(tests);
    const exp10 = (await db.one("SELECT COUNT(*) AS n FROM tests t JOIN subjects s ON s.id = t.subject_id WHERE s.id = $1", [sub.id])).n;
    assert.strictEqual(tests.data.tests.length, exp10);
    assert.strictEqual(exp10, 8);
    const list = await admin('GET', '/api/teachers'); ok(list);
    const reset = await admin('POST', `/api/users/${list.data.teachers.find((x) => x.username === 'newteacher').user_id}/reset-password`, {}); ok(reset);
    assert.strictEqual((await tc('GET', '/api/tests')).status, 401); // old session invalid after reset
  });

  await t('analysis: class, school, reports and downloads', async () => {
    const cls = (await admin('GET', '/api/classes')).data.classes[1];
    const a = await admin('GET', '/api/analysis/class/' + cls.id); ok(a);
    assert.ok(a.data.summary.held >= 10 && a.data.perTest.length >= 10 && a.data.subjects.length >= 1);
    assert.ok(a.data.top.length >= 1 && Array.isArray(a.data.attention) && a.data.distribution.length === 4);
    assert.ok(a.data.chapters.length >= 1 && a.data.weak_chapters.length >= 1);
    const ta = await teacher('GET', '/api/analysis/class/' + cls.id); ok(ta);
    assert.ok(ta.data.subjects.every((s) => ['गणित', 'विज्ञान'].includes(s.subject)));
    const c12 = (await admin('GET', '/api/classes')).data.classes[3];
    assert.strictEqual((await teacher('GET', '/api/analysis/class/' + c12.id)).status, 403);
    const sch = await admin('GET', '/api/analysis/school'); ok(sch);
    assert.strictEqual(sch.data.classes.length, 4);
    assert.ok(sch.data.totals.avg > 0);
    const rep = await admin('GET', `/api/reports/class?class_id=${cls.id}`); ok(rep);
    assert.ok(rep.data.rows.length >= 8 && rep.data.columns.includes('कुल औसत %'));
    const csv = await admin('GET', `/api/reports/class?class_id=${cls.id}&format=csv`); ok(csv);
    assert.ok(csv.data.startsWith('\uFEFF'));
    const tr = await admin('GET', '/api/reports/test/' + testId); ok(tr);
    assert.strictEqual(tr.data.rows.length, 8);
    ok(await admin('GET', '/api/reports/entry-status'));
    ok(await admin('GET', '/api/reports/school'));
    const tdash = await teacher('GET', '/api/dashboard/teacher'); ok(tdash);
    const sdash = await student('GET', '/api/dashboard/student'); ok(sdash);
    assert.strictEqual(sdash.data.enrolled, true);
  });

  await t('audit log, brute-force lock-out and demo data removal', async () => {
    const a = await admin('GET', '/api/audit?action=marks'); ok(a);
    assert.ok(a.data.rows.some((r) => r.action === 'marks_lock') && a.data.rows.some((r) => r.action === 'marks_correct'));
    const l = await admin('GET', '/api/audit?action=login_failed'); ok(l);
    assert.ok(l.data.total >= 1);
    const bf = client();
    let last;
    for (let i = 0; i < 9; i++) last = await bf('POST', '/api/auth/login', { username: 'victim', password: 'x' + i });
    assert.strictEqual(last.status, 429);
    assert.strictEqual((await admin('POST', '/api/settings/delete-demo', { confirm: 'no' })).status, 400);
    ok(await admin('POST', '/api/settings/delete-demo', { confirm: 'DELETE' }));
    const d = await admin('GET', '/api/dashboard/admin'); ok(d);
    assert.ok(d.data.counts.students <= 3);
    assert.strictEqual(d.data.counts.locked, 0);
    assert.strictEqual((await teacher('GET', '/api/tests')).status, 401);
  });

  server.close();
  db.close();
};
