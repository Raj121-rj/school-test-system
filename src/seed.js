'use strict';
// First-run seeding: settings, session, classes/subjects/chapters, the 192-test Master Calendar, admin account, optional demo data.
const path = require('path');
const db = require('./db');
const { hashPassword } = require('./auth');
const { normalizeCalendarRows } = require('./calendar');
const { applyCalendar } = require('./calendarStore');
const { createStudent } = require('./people');
const { randomPassword } = require('./util');

const SETTINGS = {
  school_name: 'विद्यालय', attention_below_pct: '40', ranking_min_tests: '3', restrict_future_entry: 'false',
  default_max_marks: '', default_duration: '', cycle_start: '2026-10-12', cycle_end: '2027-02-15',
};
const HOLIDAYS = [
  ['2026-10-19', '2026-10-19', 'अवकाश'],
  ['2026-11-05', '2026-11-11', 'दीपावली अवकाश'],
  ['2027-01-03', '2027-01-10', 'शीतकालीन अवकाश'],
];
const HEAD = ['क्रम', 'तारीख', 'दिन', 'कक्षा', 'टेस्ट नं.', 'विषय', 'सिलेबस/अध्याय', 'टेस्ट प्रकार'];

async function seedStructure() {
  const chapters = require(path.join(__dirname, '../data/chapters.json'));
  await db.tx(async (c) => {
    for (const grade of Object.keys(chapters)) {
      await c.q('INSERT INTO classes (grade, name) VALUES ($1,$2) ON CONFLICT (grade) DO NOTHING', [Number(grade), `कक्षा ${grade}`]);
      const cls = await c.one('SELECT id FROM classes WHERE grade = $1', [Number(grade)]);
      for (const subject of Object.keys(chapters[grade])) {
        await c.q('INSERT INTO subjects (class_id, name) VALUES ($1,$2) ON CONFLICT (class_id, name) DO NOTHING', [cls.id, subject]);
        const sb = await c.one('SELECT id FROM subjects WHERE class_id = $1 AND name = $2', [cls.id, subject]);
        const titles = chapters[grade][subject];
        for (let i = 0; i < titles.length; i++) {
          await c.q('INSERT INTO chapters (subject_id, chapter_no, title) VALUES ($1,$2,$3) ON CONFLICT (subject_id, chapter_no) DO NOTHING', [sb.id, i + 1, titles[i]]);
        }
      }
    }
  });
}

async function ensureAdmin() {
  if (await db.one("SELECT id FROM users WHERE role = 'admin' LIMIT 1")) return;
  const isProd = process.env.NODE_ENV === 'production';
  const username = String(process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
  let password = process.env.ADMIN_PASSWORD;
  let must = false;
  if (!password) {
    password = isProd ? randomPassword(12) : 'Admin@123';
    must = isProd;
    console.log(`[setup] ADMIN_PASSWORD सेट नहीं था। पहला एडमिन -> username: ${username}  password: ${password}${must ? '  (पहले लॉगिन पर बदलना होगा)' : '  (सिर्फ़ development/test के लिए)'}`);
  }
  await db.q('INSERT INTO users (username, password_hash, role, full_name, must_change_password) VALUES ($1,$2,$3,$4,$5)', [username, await hashPassword(password), 'admin', 'एडमिन', must]);
  console.log(`[setup] एडमिन खाता बना: ${username}`);
}

// small deterministic PRNG so demo data is repeatable
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const DEMO_NAMES = ['आरव शर्मा', 'अनन्या वर्मा', 'कबीर मीणा', 'दिव्या गुप्ता', 'रोहन यादव', 'सिमरन जाट', 'मोहित सैनी', 'काव्या राठौड़'];

async function seedDemo(sessionId) {
  const done = await db.one("SELECT value FROM settings WHERE key = 'demo_seeded'");
  if (done) return;
  const pwHash = await hashPassword('Student@123');
  const teacherHash = await hashPassword('Teacher@123');
  await db.tx(async (c) => {
    await c.q('UPDATE tests SET max_marks = 20 WHERE max_marks IS NULL');
    await c.q('UPDATE tests SET duration_min = 40 WHERE duration_min IS NULL');
    const classes = await c.all('SELECT id, grade FROM classes ORDER BY grade');
    // demo teacher: Class 8 गणित+विज्ञान, Class 10 गणित, Class 5 गणित
    const u = await c.one("INSERT INTO users (username, password_hash, role, full_name, is_demo) VALUES ('teacher1',$1,'teacher','डेमो शिक्षक',true) RETURNING id", [teacherHash]);
    const t = await c.one('INSERT INTO teachers (user_id, phone) VALUES ($1,$2) RETURNING id', [u.id, '9999999999']);
    const want = [[8, 'गणित'], [8, 'विज्ञान'], [10, 'गणित'], [5, 'गणित']];
    for (const [g, sname] of want) {
      const sb = await c.one('SELECT sb.id FROM subjects sb JOIN classes cl ON cl.id = sb.class_id WHERE cl.grade = $1 AND sb.name = $2', [g, sname]);
      if (sb) await c.q('INSERT INTO teacher_assignments (teacher_id, subject_id) VALUES ($1,$2)', [t.id, sb.id]);
    }
    for (const cls of classes) {
      const tests = await c.all('SELECT id, test_no FROM tests WHERE class_id = $1 AND session_id = $2 AND test_no <= 14 ORDER BY test_no', [cls.id, sessionId]);
      for (let i = 0; i < DEMO_NAMES.length; i++) {
        const st = await createStudent(c, { name: DEMO_NAMES[i], father_name: 'डेमो अभिभावक', gender: i % 2 ? 'F' : 'M', class_id: cls.id, roll_no: i + 1, session_id: sessionId, password: 'Student@123', hash: pwHash, is_demo: true });
        const rand = rng(cls.grade * 1000 + i * 17 + 3);
        const base = 45 + ((i * 11) % 40);
        const slope = i % 3 === 0 ? 1.4 : i % 3 === 1 ? -1.1 : 0;
        for (const test of tests) {
          const absent = rand() < 0.06;
          const pct = Math.max(8, Math.min(100, base + slope * test.test_no + (rand() - 0.5) * 24));
          const marks = Math.round(((pct / 100) * 20) * 2) / 2;
          await c.q('INSERT INTO marks (test_id, student_id, marks, status) VALUES ($1,$2,$3,$4)', [test.id, st.id, absent ? null : marks, absent ? 'absent' : 'present']);
        }
      }
      await c.q("UPDATE tests SET marks_locked = true, status = 'Completed' WHERE class_id = $1 AND session_id = $2 AND test_no <= 10", [cls.id, sessionId]);
    }
    await c.q("INSERT INTO settings (key, value) VALUES ('demo_seeded','1') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value");
  });
  console.log('[setup] डेमो डेटा बना (teacher1 / Teacher@123, विद्यार्थी ST00001... / Student@123)');
}

async function seed({ demo = false } = {}) {
  for (const [k, v] of Object.entries(SETTINGS)) await db.q('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING', [k, v]);
  if (!(await db.one('SELECT id FROM sessions LIMIT 1'))) await db.q("INSERT INTO sessions (name, is_current) VALUES ('2026-27', true)");
  const session = await db.one('SELECT id FROM sessions WHERE is_current = true ORDER BY id DESC LIMIT 1');
  if (!(await db.one('SELECT id FROM chapters LIMIT 1'))) await seedStructure();
  if (!(await db.one('SELECT id FROM holidays LIMIT 1'))) for (const h of HOLIDAYS) await db.q('INSERT INTO holidays (start_date, end_date, note) VALUES ($1,$2,$3)', h);
  if ((await db.one('SELECT COUNT(*) AS n FROM tests')).n === 0) {
    const cal = require(path.join(__dirname, '../data/master_calendar.json'));
    const matrix = [HEAD, ...cal.map((r) => [r.seq, r.date, r.day, r.class, r.test_no, r.subject, r.syllabus, r.type])];
    const holidays = (await db.all('SELECT start_date, end_date, note FROM holidays'));
    const parsed = normalizeCalendarRows(matrix, { holidays });
    if (parsed.errors.length) throw new Error('Master Calendar त्रुटि: ' + JSON.stringify(parsed.errors.slice(0, 3)));
    const res = await applyCalendar(parsed.rows, session.id);
    if (!res.ok) throw new Error('Master Calendar लागू नहीं हुआ: ' + JSON.stringify(res.errors.slice(0, 3)));
    console.log(`[setup] Master Calendar लोड हुआ: ${res.inserted} टेस्ट`);
  }
  await ensureAdmin();
  if (demo) await seedDemo(session.id);
}

module.exports = { seed };
