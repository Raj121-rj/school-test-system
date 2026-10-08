'use strict';
// Student / class / school analysis and downloadable reports. All numbers are computed from raw marks.
const db = require('../db');
const { HttpError } = require('../http');
const A = require('../auth');
const { currentSession, getSettings, teacherSubjects, sendTable } = require('../core');
const { asInt, inList, todayStr } = require('../util');
const AN = require('../analytics');

async function heldTests(classId, sessionId, { subjectIds, onlyLocked }) {
  const params = [classId, sessionId];
  let sql = `SELECT t.id, t.test_code, t.test_no, t.test_date, t.max_marks, t.subject_id, t.syllabus, t.test_type, sb.name AS subject_name
    FROM tests t JOIN subjects sb ON sb.id = t.subject_id
    WHERE t.class_id = $1 AND t.session_id = $2 AND t.status IN ('Scheduled','Completed') AND t.max_marks > 0`;
  sql += onlyLocked ? ' AND t.marks_locked = true' : ' AND (t.marks_locked = true OR EXISTS (SELECT 1 FROM marks m WHERE m.test_id = t.id))';
  if (subjectIds) {
    if (!subjectIds.length) return [];
    sql += ` AND t.subject_id IN (${inList(subjectIds, 3)})`;
    params.push(...subjectIds);
  }
  return db.all(sql + ' ORDER BY t.test_date, t.test_no', params);
}
const rosterOf = (classId, sessionId) => db.all(
  `SELECT s.id, s.student_code, s.name, h.roll_no FROM student_class_history h JOIN students s ON s.id = h.student_id
   WHERE h.class_id = $1 AND h.session_id = $2 AND h.status = 'active' AND s.active = true ORDER BY h.roll_no`, [classId, sessionId]);
async function recsFor(tests, studentIds) {
  if (!tests.length) return [];
  const tmap = new Map(tests.map((t) => [t.id, t]));
  const ids = tests.map((t) => t.id);
  const rows = await db.all(`SELECT m.student_id, m.test_id, m.marks, m.status FROM marks m WHERE m.test_id IN (${inList(ids)})`, ids);
  const only = studentIds ? new Set(studentIds) : null;
  return rows.filter((r) => !only || only.has(r.student_id)).map((r) => {
    const t = tmap.get(r.test_id);
    return AN.enrich({ ...r, subject_id: t.subject_id, subject_name: t.subject_name, test_no: t.test_no, test_date: t.test_date, max_marks: t.max_marks });
  });
}
async function chaptersOf(tests) {
  const map = new Map();
  if (!tests.length) return map;
  const ids = tests.map((t) => t.id);
  const rows = await db.all(
    `SELECT tc.test_id, ch.id AS chapter_id, ch.subject_id, ch.chapter_no, ch.title FROM test_chapters tc JOIN chapters ch ON ch.id = tc.chapter_id WHERE tc.test_id IN (${inList(ids)})`, ids);
  for (const r of rows) { if (!map.has(r.test_id)) map.set(r.test_id, []); map.get(r.test_id).push(r); }
  return map;
}
// What a user may see in a class: admin = everything, teacher = assigned subjects only, student = locked (final) marks only
async function scopeFor(user, classId) {
  if (user.role === 'admin') return { subjectIds: null, onlyLocked: false };
  if (user.role === 'teacher') {
    const mine = (await teacherSubjects(user)).filter((s) => s.class_id === classId);
    if (!mine.length) throw new HttpError(403, 'यह कक्षा आपको नहीं सौंपी गई');
    return { subjectIds: mine.map((s) => s.subject_id), onlyLocked: false };
  }
  return { subjectIds: null, onlyLocked: true };
}
async function sessionFrom(req) {
  if (req.query.session_id) {
    const s = await db.one('SELECT id, name FROM sessions WHERE id = $1', [asInt(req.query.session_id, 'session_id')]);
    if (!s) throw new HttpError(404, 'सत्र नहीं मिला');
    return s;
  }
  return currentSession();
}
const groupChapters = (chap, tests) => {
  const names = new Map(tests.map((t) => [t.subject_id, t.subject_name]));
  return [...new Set(chap.map((c) => c.subject_id))].map((sid) => ({ subject_id: sid, subject: names.get(sid), chapters: chap.filter((c) => c.subject_id === sid) }));
};

async function studentAnalysis(user, studentId, sessionId) {
  if (user.role === 'student' && studentId !== user.student_id) throw new HttpError(403, 'आप सिर्फ़ अपना डेटा देख सकते हैं');
  const st = await db.one(
    `SELECT s.id, s.student_code AS code, s.name, h.class_id, h.roll_no, c.grade, c.name AS class_name
     FROM students s JOIN student_class_history h ON h.student_id = s.id AND h.session_id = $2 JOIN classes c ON c.id = h.class_id WHERE s.id = $1`, [studentId, sessionId]);
  if (!st) throw new HttpError(404, 'इस सत्र में विद्यार्थी का रिकॉर्ड नहीं मिला');
  const sc = await scopeFor(user, st.class_id);
  const tests = await heldTests(st.class_id, sessionId, sc);
  const recs = await recsFor(tests, [studentId]);
  const summary = AN.summarize(recs, tests.length);
  const chapters = groupChapters(AN.chapterStats(recs, await chaptersOf(tests)), tests);
  const tmap = new Map(tests.map((t) => [t.id, t]));
  const timeline = [...recs].sort(AN.byTime).map((r) => ({ test_id: r.test_id, test_code: tmap.get(r.test_id).test_code, date: r.test_date, subject: r.subject_name, marks: r.marks, max: r.max_marks, pct: AN.r1(r.pct), status: r.status }));
  const sessions = await db.all('SELECT ss.id, ss.name FROM student_class_history h JOIN sessions ss ON ss.id = h.session_id WHERE h.student_id = $1 ORDER BY ss.id', [studentId]);
  return { student: st, summary, chapters, timeline, sessions };
}

async function classAnalysisFor(user, classId, sessionId, subjectParam) {
  const cls = await db.one('SELECT id, grade, name FROM classes WHERE id = $1', [classId]);
  if (!cls) throw new HttpError(404, 'कक्षा नहीं मिली');
  const sc = await scopeFor(user, classId);
  let subjectIds = sc.subjectIds;
  if (subjectParam) {
    const sid = asInt(subjectParam, 'subject_id');
    if (subjectIds && !subjectIds.includes(sid)) throw new HttpError(403, 'यह विषय आपको नहीं सौंपा गया');
    subjectIds = [sid];
  }
  const tests = await heldTests(classId, sessionId, { subjectIds, onlyLocked: sc.onlyLocked });
  const students = await rosterOf(classId, sessionId);
  const recs = await recsFor(tests, students.map((s) => s.id));
  const out = AN.classAnalysis({ students, tests, recs, settings: await getSettings() });
  const chap = AN.chapterStats(recs, await chaptersOf(tests));
  const names = new Map(tests.map((t) => [t.subject_id, t.subject_name]));
  const weak = chap.filter((c) => c.avg != null).sort((a, b) => a.avg - b.avg).slice(0, 10).map((c) => ({ ...c, subject: names.get(c.subject_id) }));
  return { cls, tests, students, recs, out, chapters: groupChapters(chap, tests), weak };
}

async function schoolAnalysis(sessionId) {
  const settings = await getSettings();
  const classes = await db.all('SELECT id, grade, name FROM classes ORDER BY grade');
  const rows = [];
  const top = [];
  const attention = [];
  const subjects = [];
  let allSum = 0;
  let allN = 0;
  for (const c of classes) {
    const students = await rosterOf(c.id, sessionId);
    const tests = await heldTests(c.id, sessionId, { subjectIds: null, onlyLocked: false });
    const recs = await recsFor(tests, students.map((s) => s.id));
    const a = AN.classAnalysis({ students, tests, recs, settings });
    const pend = await db.one("SELECT COUNT(*) AS n FROM tests WHERE class_id = $1 AND session_id = $2 AND marks_locked = false AND status IN ('Scheduled','Completed') AND test_date <= $3", [c.id, sessionId, todayStr()]);
    const expected = students.length * tests.length;
    rows.push({ class_id: c.id, grade: c.grade, name: c.name, students: students.length, held: tests.length, avg: a.summary.avg, attention: a.attention.length, entry_pct: expected ? Math.round((recs.length / expected) * 100) : null, pending_tests: pend.n });
    a.top.forEach((t) => top.push({ ...t, grade: c.grade, class_name: c.name }));
    a.attention.forEach((t) => attention.push({ ...t, grade: c.grade, class_name: c.name }));
    a.subjects.forEach((s) => subjects.push({ grade: c.grade, class_name: c.name, subject: s.subject, avg: s.avg, tests: s.tests }));
    recs.forEach((r) => { if (r.pct != null) { allSum += r.pct; allN++; } });
  }
  top.sort((x, y) => y.avg - x.avg);
  attention.sort((x, y) => (x.avg ?? 101) - (y.avg ?? 101));
  return { classes: rows, top: top.slice(0, 10), attention: attention.slice(0, 30), subjects, totals: { students: rows.reduce((n, r) => n + r.students, 0), avg: allN ? AN.r1(allSum / allN) : null, attention: attention.length } };
}

const TREND_HI = { improving: 'सुधार', stable: 'स्थिर', declining: 'गिरावट', insufficient: 'डेटा कम' };

module.exports = function register(app) {
  const admin = A.requireRole('admin');
  const staff = A.requireRole('admin', 'teacher');
  const any = A.requireRole('admin', 'teacher', 'student');

  app.get('/api/analysis/student/:id', any, async (req, res) => {
    const id = req.params.id === 'me' ? req.user.student_id : asInt(req.params.id, 'विद्यार्थी');
    if (!id) throw new HttpError(404, 'विद्यार्थी नहीं मिला');
    const sess = await sessionFrom(req);
    res.json(await studentAnalysis(req.user, id, sess.id));
  });

  app.get('/api/analysis/class/:id', staff, async (req, res) => {
    const sess = await sessionFrom(req);
    const r = await classAnalysisFor(req.user, asInt(req.params.id, 'कक्षा'), sess.id, req.query.subject_id);
    res.json({ class: r.cls, ...r.out, chapters: r.chapters, weak_chapters: r.weak });
  });

  app.get('/api/analysis/school', admin, async (req, res) => {
    const sess = await sessionFrom(req);
    res.json(await schoolAnalysis(sess.id));
  });

  // ---------- reports (JSON for on-screen/print, csv, xlsx) ----------
  app.get('/api/reports/class', staff, async (req, res) => {
    const sess = await sessionFrom(req);
    const r = await classAnalysisFor(req.user, asInt(req.query.class_id, 'कक्षा'), sess.id, req.query.subject_id);
    const bySt = new Map(r.students.map((s) => [s.id, []]));
    r.recs.forEach((x) => bySt.get(x.student_id) && bySt.get(x.student_id).push(x));
    let columns;
    let rows;
    if (req.query.subject_id) {
      columns = ['रोल', 'Student ID', 'नाम', ...r.tests.map((t) => `टेस्ट ${t.test_no} (${t.test_date}) /${t.max_marks}`), 'औसत %', 'दिए'];
      rows = r.students.map((s) => {
        const mine = new Map(bySt.get(s.id).map((x) => [x.test_id, x]));
        const sm = AN.summarize(bySt.get(s.id), r.tests.length);
        return [s.roll_no, s.student_code, s.name, ...r.tests.map((t) => { const x = mine.get(t.id); return !x ? '' : x.status === 'absent' ? 'अनु.' : x.marks; }), sm.avg ?? '', sm.given];
      });
    } else {
      const subs = [...new Map(r.tests.map((t) => [t.subject_id, t.subject_name])).entries()];
      columns = ['रोल', 'Student ID', 'नाम', ...subs.map(([, n]) => n + ' %'), 'कुल औसत %', 'टेस्ट दिए', 'अनुपस्थित', 'प्रवृत्ति'];
      rows = r.students.map((s) => {
        const sm = AN.summarize(bySt.get(s.id), r.tests.length);
        return [s.roll_no, s.student_code, s.name, ...subs.map(([sid]) => { const x = sm.subjects.find((y) => y.subject_id === sid); return x ? x.avg : ''; }), sm.avg ?? '', sm.given, sm.absent, TREND_HI[sm.trend]];
      });
    }
    await sendTable(res, req.query.format, `class_${r.cls.grade}_report`, { title: `${r.cls.name} रिपोर्ट`, columns, rows, meta: { class: r.cls.name, session: sess.name, held: r.tests.length, avg: r.out.summary.avg } });
  });

  app.get('/api/reports/student/:id', any, async (req, res) => {
    const id = req.params.id === 'me' ? req.user.student_id : asInt(req.params.id, 'विद्यार्थी');
    const sess = await sessionFrom(req);
    const a = await studentAnalysis(req.user, id, sess.id);
    const s = a.summary;
    await sendTable(res, req.query.format, `student_${a.student.code}_report`, {
      title: `${a.student.name} — रिपोर्ट`,
      columns: ['तारीख', 'टेस्ट ID', 'विषय', 'प्राप्तांक', 'पूर्णांक', '%', 'स्थिति'],
      rows: a.timeline.map((t) => [t.date, t.test_code, t.subject, t.status === 'absent' ? '' : t.marks, t.max, t.status === 'absent' ? '' : t.pct, t.status === 'absent' ? 'अनुपस्थित' : 'उपस्थित']),
      meta: { student: a.student, session: sess.name, summary: { held: s.held, given: s.given, absent: s.absent, avg: s.avg, highest: s.highest, lowest: s.lowest, best: s.best && s.best.subject, weakest: s.weakest && s.weakest.subject, trend: TREND_HI[s.trend], improvement: s.improvement }, subjects: s.subjects },
    });
  });

  app.get('/api/reports/test/:id', staff, async (req, res) => {
    const id = asInt(req.params.id, 'टेस्ट');
    const t = await db.one('SELECT t.id, t.session_id, t.class_id, t.subject_id, t.test_code, t.test_date, t.max_marks, c.name AS class_name, sb.name AS subject_name FROM tests t JOIN classes c ON c.id = t.class_id JOIN subjects sb ON sb.id = t.subject_id WHERE t.id = $1', [id]);
    if (!t) throw new HttpError(404, 'टेस्ट नहीं मिला');
    if (req.user.role === 'teacher' && !(await teacherSubjects(req.user)).some((s) => s.subject_id === t.subject_id)) throw new HttpError(403, 'यह टेस्ट आपके विषय का नहीं है');
    const people = await rosterOf(t.class_id, t.session_id);
    const marks = new Map((await db.all('SELECT student_id, marks, status FROM marks WHERE test_id = $1', [id])).map((m) => [m.student_id, m]));
    const present = [...marks.values()].filter((m) => m.status === 'present' && t.max_marks > 0).map((m) => (m.marks / t.max_marks) * 100);
    await sendTable(res, req.query.format, `test_${t.test_code}_marks`, {
      title: `${t.class_name} ${t.subject_name} — ${t.test_code}`,
      columns: ['रोल', 'Student ID', 'नाम', 'प्राप्तांक', 'पूर्णांक', '%', 'स्थिति'],
      rows: people.map((p) => { const m = marks.get(p.id); return [p.roll_no, p.student_code, p.name, m && m.status === 'present' ? m.marks : '', t.max_marks, m && m.status === 'present' && t.max_marks > 0 ? AN.r1((m.marks / t.max_marks) * 100) : '', !m ? 'बाकी' : m.status === 'absent' ? 'अनुपस्थित' : 'उपस्थित']; }),
      meta: { test: t.test_code, date: t.test_date, class: t.class_name, subject: t.subject_name, given: present.length, avg: present.length ? AN.r1(AN.mean(present)) : null, highest: present.length ? AN.r1(Math.max(...present)) : null, lowest: present.length ? AN.r1(Math.min(...present)) : null },
    });
  });

  app.get('/api/reports/entry-status', admin, async (req, res) => {
    const sess = await currentSession();
    const rows = await db.all(
      `SELECT t.test_code, t.test_date, c.name AS class_name, sb.name AS subject_name, t.status, t.marks_locked,
        (SELECT COUNT(*) FROM marks m WHERE m.test_id = t.id) AS entered,
        (SELECT COUNT(*) FROM student_class_history h JOIN students st ON st.id = h.student_id WHERE h.class_id = t.class_id AND h.session_id = t.session_id AND h.status = 'active' AND st.active = true) AS enrolled
       FROM tests t JOIN classes c ON c.id = t.class_id JOIN subjects sb ON sb.id = t.subject_id
       WHERE t.session_id = $1 AND t.marks_locked = false AND t.status IN ('Scheduled','Completed') AND t.test_date <= $2 ORDER BY t.test_date, c.grade`, [sess.id, todayStr()]);
    await sendTable(res, req.query.format, 'marks_entry_pending', {
      title: 'अंक-प्रविष्टि बाकी',
      columns: ['Test ID', 'तारीख', 'कक्षा', 'विषय', 'विद्यार्थी', 'अंक दर्ज', 'बाकी'],
      rows: rows.map((r) => [r.test_code, r.test_date, r.class_name, r.subject_name, r.enrolled, r.entered, Math.max(0, r.enrolled - r.entered)]),
    });
  });

  app.get('/api/reports/school', admin, async (req, res) => {
    const sess = await sessionFrom(req);
    const a = await schoolAnalysis(sess.id);
    await sendTable(res, req.query.format, 'school_summary', {
      title: 'विद्यालय सारांश',
      columns: ['कक्षा', 'विद्यार्थी', 'हुए टेस्ट', 'औसत %', 'ध्यान चाहिए', 'अंक-प्रविष्टि %', 'बाकी टेस्ट'],
      rows: a.classes.map((c) => [c.name, c.students, c.held, c.avg ?? '', c.attention, c.entry_pct ?? '', c.pending_tests]),
      meta: { session: sess.name, totals: a.totals },
    });
  });
};
