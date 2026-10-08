'use strict';
// Role dashboards
const db = require('../db');
const A = require('../auth');
const { currentSession, teacherSubjects } = require('../core');
const { inList, todayStr } = require('../util');
const { TEST_SELECT } = require('./tests');

module.exports = function register(app) {
  app.get('/api/dashboard/admin', A.requireRole('admin'), async (req, res) => {
    const sess = await currentSession();
    const today = todayStr();
    const counts = await db.one(
      `SELECT
        (SELECT COUNT(*) FROM student_class_history h JOIN students s ON s.id = h.student_id WHERE h.session_id = $1 AND h.status = 'active' AND s.active = true) AS students,
        (SELECT COUNT(*) FROM teachers t JOIN users u ON u.id = t.user_id WHERE u.active = true) AS teachers,
        (SELECT COUNT(*) FROM tests WHERE session_id = $1) AS tests,
        (SELECT COUNT(*) FROM tests WHERE session_id = $1 AND marks_locked = true) AS locked,
        (SELECT COUNT(*) FROM tests WHERE session_id = $1 AND max_marks IS NULL) AS no_max,
        (SELECT COUNT(*) FROM tests WHERE session_id = $1 AND marks_locked = false AND status IN ('Scheduled','Completed') AND test_date <= $2) AS pending`, [sess.id, today]);
    const byStatus = await db.all('SELECT status, COUNT(*) AS n FROM tests WHERE session_id = $1 GROUP BY status', [sess.id]);
    const classes = await db.all(
      `SELECT c.id, c.grade, c.name,
        (SELECT COUNT(*) FROM student_class_history h JOIN students s ON s.id = h.student_id WHERE h.class_id = c.id AND h.session_id = $1 AND h.status = 'active' AND s.active = true) AS students
       FROM classes c ORDER BY c.grade`, [sess.id]);
    const todayTests = await db.all(`${TEST_SELECT} WHERE t.session_id = $1 AND t.test_date = $2 ORDER BY c.grade`, [sess.id, today]);
    const upcoming = await db.all(`${TEST_SELECT} WHERE t.session_id = $1 AND t.test_date > $2 AND t.status IN ('Scheduled') ORDER BY t.test_date, c.grade LIMIT 8`, [sess.id, today]);
    const audit = await db.all('SELECT id, action, username, entity, entity_id, created_at FROM audit_logs ORDER BY id DESC LIMIT 8');
    res.json({ session: sess, today, counts, by_status: byStatus, classes, today_tests: todayTests, upcoming, audit });
  });

  app.get('/api/dashboard/teacher', A.requireRole('teacher'), async (req, res) => {
    const sess = await currentSession();
    const today = todayStr();
    const subs = await teacherSubjects(req.user);
    if (!subs.length) return res.json({ session: sess, today, subjects: [], today_tests: [], pending: [], upcoming: [] });
    const ids = subs.map((s) => s.subject_id);
    const base = `${TEST_SELECT} WHERE t.session_id = $1 AND t.subject_id IN (${inList(ids, 3)})`;
    const p = [sess.id, today, ...ids];
    // $2 (today) is used below with different comparisons, so each query gets its own parameter list
    const todayTests = await db.all(`${base} AND t.test_date = $2 ORDER BY c.grade`, p);
    const pending = await db.all(`${base} AND t.test_date < $2 AND t.marks_locked = false AND t.status IN ('Scheduled','Completed') ORDER BY t.test_date LIMIT 30`, p);
    const upcoming = await db.all(`${base} AND t.test_date > $2 AND t.status = 'Scheduled' ORDER BY t.test_date, c.grade LIMIT 8`, p);
    res.json({ session: sess, today, subjects: subs, today_tests: todayTests, pending, upcoming });
  });

  app.get('/api/dashboard/student', A.requireRole('student'), async (req, res) => {
    const sess = await currentSession();
    const today = todayStr();
    const enr = await db.one(
      `SELECT h.class_id, h.roll_no, c.name AS class_name, s.name, s.student_code AS code FROM student_class_history h
       JOIN classes c ON c.id = h.class_id JOIN students s ON s.id = h.student_id
       WHERE h.student_id = $1 AND h.session_id = $2 AND h.status = 'active'`, [req.user.student_id, sess.id]);
    if (!enr) return res.json({ session: sess, today, enrolled: false });
    const upcoming = await db.all(
      `SELECT t.test_code, t.test_no, t.test_date, t.test_type, t.syllabus, t.max_marks, t.duration_min, sb.name AS subject_name
       FROM tests t JOIN subjects sb ON sb.id = t.subject_id
       WHERE t.class_id = $1 AND t.session_id = $2 AND t.test_date >= $3 AND t.status = 'Scheduled' ORDER BY t.test_date LIMIT 6`, [enr.class_id, sess.id, today]);
    res.json({ session: sess, today, enrolled: true, student: enr, upcoming });
  });
};
