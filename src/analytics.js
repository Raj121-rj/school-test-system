'use strict';
// Pure analysis functions. Everything is computed from raw marks records; nothing derived is stored.
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const r1 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10) / 10);
const pctOf = (marks, max) => (max > 0 && marks != null ? (marks / max) * 100 : null);
const byTime = (a, b) => (a.test_date < b.test_date ? -1 : a.test_date > b.test_date ? 1 : (a.test_no - b.test_no) || (a.test_id - b.test_id));

// rec: {student_id,test_id,subject_id,subject_name,test_no,test_date,max_marks,marks,status}
const enrich = (rec) => ({ ...rec, pct: rec.status === 'present' ? pctOf(rec.marks, rec.max_marks) : null });

// pcts in chronological order. Needs >= 4 tests, otherwise no trend is claimed.
function trendOf(pcts) {
  const n = pcts.length;
  if (n < 4) return { label: 'insufficient', delta: null };
  const k = Math.min(3, Math.floor(n / 2));
  const delta = mean(pcts.slice(-k)) - mean(pcts.slice(-2 * k, -k));
  return { label: delta > 5 ? 'improving' : delta < -5 ? 'declining' : 'stable', delta: r1(delta) };
}

// recs: one student's enriched records; held: number of tests held in scope
function summarize(recs, held) {
  const sorted = [...recs].sort(byTime);
  const present = sorted.filter((r) => r.pct != null);
  const out = { held, given: present.length, absent: sorted.filter((r) => r.status === 'absent').length, avg: null, highest: null, lowest: null, best: null, weakest: null, improvement: null, trend: 'insufficient', recent: [], subjects: [] };
  if (!present.length) return out;
  const ps = present.map((r) => r.pct);
  out.avg = r1(mean(ps));
  out.highest = r1(Math.max(...ps));
  out.lowest = r1(Math.min(...ps));
  const by = new Map();
  for (const r of present) {
    if (!by.has(r.subject_id)) by.set(r.subject_id, { subject_id: r.subject_id, subject: r.subject_name, p: [] });
    by.get(r.subject_id).p.push(r.pct);
  }
  out.subjects = [...by.values()].map((s) => ({ subject_id: s.subject_id, subject: s.subject, tests: s.p.length, avg: r1(mean(s.p)), highest: r1(Math.max(...s.p)), lowest: r1(Math.min(...s.p)), trend: trendOf(s.p).label })).sort((a, b) => b.avg - a.avg);
  out.best = out.subjects[0];
  if (out.subjects.length > 1) out.weakest = out.subjects[out.subjects.length - 1];
  const t = trendOf(ps);
  out.trend = t.label;
  out.improvement = t.delta;
  out.recent = present.slice(-5).reverse().map((r) => ({ test_id: r.test_id, date: r.test_date, subject: r.subject_name, marks: r.marks, max: r.max_marks, pct: r1(r.pct) }));
  return out;
}

// testChapters: Map(test_id -> [{chapter_id, subject_id, chapter_no, title}])
function chapterStats(recs, testChapters) {
  const m = new Map();
  for (const r of recs) {
    if (r.pct == null) continue;
    for (const c of testChapters.get(r.test_id) || []) {
      let e = m.get(c.chapter_id);
      if (!e) { e = { chapter_id: c.chapter_id, subject_id: c.subject_id, chapter_no: c.chapter_no, title: c.title, p: [], tests: new Set() }; m.set(c.chapter_id, e); }
      e.p.push(r.pct);
      e.tests.add(r.test_id);
    }
  }
  return [...m.values()].map((e) => ({ chapter_id: e.chapter_id, subject_id: e.subject_id, chapter_no: e.chapter_no, title: e.title, tests: e.tests.size, avg: r1(mean(e.p)) })).sort((a, b) => a.subject_id - b.subject_id || a.chapter_no - b.chapter_no);
}

const BANDS = [['0–39', 0, 40], ['40–59', 40, 60], ['60–79', 60, 80], ['80–100', 80, 101]];

// students: [{id,name,roll_no,student_code}], tests: held tests [{id,test_code,test_no,test_date,subject_id,subject_name,syllabus}], recs: enriched records
function classAnalysis({ students, tests, recs, settings = {} }) {
  const thr = Number(settings.attention_below_pct) || 40;
  const minT = Math.max(1, Math.min(Number(settings.ranking_min_tests) || 3, tests.length || 1));
  const byStu = new Map(students.map((s) => [s.id, []]));
  const byTest = new Map(tests.map((t) => [t.id, []]));
  for (const r of recs) { if (byStu.has(r.student_id)) byStu.get(r.student_id).push(r); if (byTest.has(r.test_id)) byTest.get(r.test_id).push(r); }
  const rows = students.map((s) => {
    const sm = summarize(byStu.get(s.id), tests.length);
    return { student_id: s.id, name: s.name, roll_no: s.roll_no, student_code: s.student_code, given: sm.given, absent: sm.absent, avg: sm.avg, trend: sm.trend, improvement: sm.improvement, best: sm.best && sm.best.subject, weakest: sm.weakest && sm.weakest.subject };
  });
  const perTest = tests.map((t) => {
    const rr = byTest.get(t.id);
    const p = rr.filter((r) => r.pct != null).map((r) => r.pct);
    return { test_id: t.id, test_code: t.test_code, test_no: t.test_no, date: t.test_date, subject_id: t.subject_id, subject: t.subject_name, syllabus: t.syllabus, given: p.length, absent: rr.filter((r) => r.status === 'absent').length, avg: p.length ? r1(mean(p)) : null, highest: p.length ? r1(Math.max(...p)) : null, lowest: p.length ? r1(Math.min(...p)) : null };
  }).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.test_no - b.test_no));
  const subj = new Map();
  for (const r of recs) {
    if (r.pct == null) continue;
    if (!subj.has(r.subject_id)) subj.set(r.subject_id, { subject_id: r.subject_id, subject: r.subject_name, p: [], tests: new Set() });
    const e = subj.get(r.subject_id);
    e.p.push(r.pct);
    e.tests.add(r.test_id);
  }
  const subjects = [...subj.values()].map((e) => ({ subject_id: e.subject_id, subject: e.subject, tests: e.tests.size, avg: r1(mean(e.p)) })).sort((a, b) => b.avg - a.avg);
  const all = recs.filter((r) => r.pct != null).map((r) => r.pct);
  const ranked = rows.filter((r) => r.avg != null && r.given >= minT).sort((a, b) => b.avg - a.avg || a.roll_no - b.roll_no);
  const attention = rows.map((r) => {
    const reasons = [];
    if (r.avg != null && r.given >= 2 && r.avg < thr) reasons.push(`औसत ${r.avg}% (${thr}% से कम)`);
    if (r.trend === 'declining' && r.improvement != null && r.improvement <= -10) reasons.push(`गिरावट ${r.improvement} अंक`);
    if (r.absent >= 3) reasons.push(`${r.absent} टेस्ट में अनुपस्थित`);
    return reasons.length ? { ...r, reasons } : null;
  }).filter(Boolean).sort((a, b) => (a.avg ?? 101) - (b.avg ?? 101));
  const avgs = rows.filter((r) => r.avg != null).map((r) => r.avg);
  const distribution = BANDS.map(([label, lo, hi]) => ({ label, count: avgs.filter((a) => a >= lo && a < hi).length }));
  return {
    summary: { students: students.length, held: tests.length, avg: all.length ? r1(mean(all)) : null, entries: recs.length, attention: attention.length },
    students: rows, perTest, subjects, distribution, top: ranked.slice(0, 5), attention, threshold: thr,
  };
}

module.exports = { mean, r1, pctOf, enrich, trendOf, summarize, chapterStats, classAnalysis, byTime };
