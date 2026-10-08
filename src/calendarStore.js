'use strict';
// Applies parsed Master Calendar rows to the database (used by first-run seeding and Admin > Import Calendar).
const db = require('./db');
const { HttpError } = require('./http');
const { linkChapters } = require('./calendar');
const { pad2 } = require('./util');

async function applyCalendar(rows, sessionId) {
  const classes = await db.all('SELECT id, grade FROM classes');
  const subjects = await db.all('SELECT id, class_id, name FROM subjects');
  const chapters = await db.all('SELECT id, subject_id, chapter_no, title FROM chapters ORDER BY subject_id, chapter_no');
  const clsByGrade = new Map(classes.map((c) => [c.grade, c]));
  const subByKey = new Map(subjects.map((s) => [`${s.class_id}|${s.name}`, s]));
  const chBySub = new Map();
  for (const c of chapters) {
    if (!chBySub.has(c.subject_id)) chBySub.set(c.subject_id, []);
    chBySub.get(c.subject_id).push(c);
  }
  const errors = [];
  const warnings = [];
  const plan = [];
  for (const r of rows) {
    const cls = clsByGrade.get(r.grade);
    if (!cls) { errors.push({ message: `कक्षा ${r.grade} सिस्टम में नहीं है (टेस्ट ${r.test_no})` }); continue; }
    const sub = subByKey.get(`${cls.id}|${r.subject}`);
    if (!sub) { errors.push({ message: `कक्षा ${r.grade}: विषय "${r.subject}" सिस्टम में नहीं है। पहले Subjects में जोड़ें (टेस्ट ${r.test_no})` }); continue; }
    const chs = chBySub.get(sub.id) || [];
    const link = linkChapters(chs.map((c) => c.title), r.syllabus);
    if (link.unmatched.length) warnings.push({ message: `कक्षा ${r.grade} टेस्ट ${r.test_no}: ये अध्याय सूची में नहीं मिले — ${link.unmatched.join(' | ')}` });
    const byNo = new Map(chs.map((c) => [c.chapter_no, c.id]));
    plan.push({ r, cls, sub, link, chapterIds: link.chapters.map((n) => byNo.get(n)).filter(Boolean), full: link.full });
  }
  if (errors.length) return { ok: false, errors, warnings };

  let inserted = 0;
  let updated = 0;
  await db.tx(async (c) => {
    for (const p of plan) {
      const { r, cls, sub } = p;
      const code = `C${cls.grade}-T${pad2(r.test_no)}`;
      const ex = await c.one('SELECT id, subject_id FROM tests WHERE session_id = $1 AND class_id = $2 AND test_no = $3', [sessionId, cls.id, r.test_no]);
      let id;
      if (ex) {
        if (ex.subject_id !== sub.id && (await c.one('SELECT id FROM marks WHERE test_id = $1 LIMIT 1', [ex.id]))) {
          throw new HttpError(400, `कक्षा ${cls.grade} टेस्ट ${r.test_no} में अंक दर्ज हैं, इसलिए विषय नहीं बदला जा सकता`);
        }
        await c.q('UPDATE tests SET subject_id = $1, test_date = $2, seq_no = $3, test_type = $4, syllabus = $5, full_syllabus = $6 WHERE id = $7',
          [sub.id, r.date, r.seq, r.type, r.syllabus, p.full, ex.id]);
        if (r.max_marks != null) await c.q('UPDATE tests SET max_marks = $1 WHERE id = $2', [r.max_marks, ex.id]);
        if (r.duration_min != null) await c.q('UPDATE tests SET duration_min = $1 WHERE id = $2', [r.duration_min, ex.id]);
        if (r.status) await c.q('UPDATE tests SET status = $1 WHERE id = $2', [r.status, ex.id]);
        id = ex.id;
        updated++;
      } else {
        const row = await c.one(
          `INSERT INTO tests (test_code, session_id, class_id, subject_id, test_no, seq_no, test_date, original_date, test_type, syllabus, full_syllabus, max_marks, duration_min, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
          [code, sessionId, cls.id, sub.id, r.test_no, r.seq, r.date, r.date, r.type, r.syllabus, p.full, r.max_marks, r.duration_min, r.status || 'Scheduled']);
        id = row.id;
        inserted++;
      }
      await c.q('DELETE FROM test_chapters WHERE test_id = $1', [id]);
      for (const chId of p.chapterIds) await c.q('INSERT INTO test_chapters (test_id, chapter_id) VALUES ($1,$2) ON CONFLICT (test_id, chapter_id) DO NOTHING', [id, chId]);
    }
  });
  return { ok: true, inserted, updated, warnings };
}

module.exports = { applyCalendar };
