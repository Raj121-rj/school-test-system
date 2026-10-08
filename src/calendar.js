'use strict';
// Master Test Calendar: parse Excel rows and link each test's syllabus to chapters.
const { toYmd, weekday } = require('./util');

const norm = (s) => String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
const core = (t) => { const i = t.indexOf(' — '); return i >= 0 ? t.slice(i + 3) : t; };
const SEP = /[\s,;/—–-]/;
// true when c occurs in u as a whole item (delimited by start/end, space, comma, dash or slash)
function has(u, c) {
  let i = u.indexOf(c);
  while (i >= 0) {
    const j = i + c.length;
    if ((i === 0 || SEP.test(u[i - 1])) && (j >= u.length || SEP.test(u[j]))) return true;
    i = u.indexOf(c, i + 1);
  }
  return false;
}
const STATUS_MAP = { scheduled: 'Scheduled', 'निर्धारित': 'Scheduled', completed: 'Completed', 'पूर्ण': 'Completed', postponed: 'Postponed', 'स्थगित': 'Postponed', cancelled: 'Cancelled', canceled: 'Cancelled', 'रद्द': 'Cancelled' };
const ALIASES = {
  seq: ['क्रम', 'seq', 'sr', 'sr no', 'sr.no'],
  date: ['तारीख', 'दिनांक', 'date'],
  day: ['दिन', 'day'],
  class: ['कक्षा', 'class'],
  test_no: ['टेस्ट नं.', 'टेस्ट नं', 'टेस्ट संख्या', 'test number', 'test no', 'test no.', 'test_no'],
  subject: ['विषय', 'subject'],
  syllabus: ['सिलेबस/अध्याय', 'सिलेबस', 'syllabus/chapters', 'syllabus/chapter', 'syllabus', 'chapters'],
  type: ['टेस्ट प्रकार', 'प्रकार', 'test type', 'type'],
  max_marks: ['पूर्णांक', 'maximum marks', 'max marks', 'max_marks'],
  duration: ['समय', 'अवधि', 'duration', 'duration (min)'],
  status: ['स्थिति', 'status'],
};

// Link a syllabus string ("अध्याय 3–4: A | B" or "पुनरावृत्ति भाग-1: A | B ...") to chapter numbers.
// titles: chapter titles of the subject in order (index + 1 = chapter_no).
function linkChapters(titles, syllabus) {
  const s = norm(syllabus);
  if (!s || /^पूर्ण\s*पाठ्यक्रम/.test(s) || /^full\s*syllabus/i.test(s)) return { chapters: [], unmatched: [], full: true };
  const ci = s.indexOf(':');
  const prefix = ci >= 0 ? s.slice(0, ci) : '';
  const body = ci >= 0 ? s.slice(ci + 1) : s;
  const m = prefix.match(/(\d+)\s*[–-]\s*(\d+)/);
  let pos = m ? Math.max(0, Number(m[1]) - 1) : 0;
  const T = titles.map(norm);
  const C = T.map(core);
  const chapters = [];
  const unmatched = [];
  for (const raw of body.split('|')) {
    const u = norm(raw);
    if (!u) continue;
    const i = T.findIndex((t, k) => k >= pos && t === u);
    if (i >= 0) { chapters.push(i + 1); pos = i + 1; continue; }
    const first = C.findIndex((c, k) => k >= pos && c.length >= 2 && has(u, c));
    if (first < 0) { unmatched.push(u); continue; }
    let k = first;
    while (k < C.length && C[k].length >= 2 && has(u, C[k])) { chapters.push(k + 1); k++; }
    pos = k;
  }
  return { chapters, unmatched, full: false };
}

// matrix: array of arrays (cells may be Date/number/string). Returns objects + errors + warnings.
function normalizeCalendarRows(matrix, { holidays = [] } = {}) {
  const errors = [];
  const warnings = [];
  const lc = (c) => norm(c).toLowerCase();
  const aliasKey = (c) => { const x = lc(c); for (const [k, list] of Object.entries(ALIASES)) if (list.includes(x)) return k; return null; };
  let hi = -1;
  for (let i = 0; i < Math.min(10, matrix.length); i++) {
    if (matrix[i].filter((c) => aliasKey(c)).length >= 3) { hi = i; break; }
  }
  if (hi < 0) return { rows: [], errors: [{ row: 1, message: 'हेडर पंक्ति नहीं मिली (तारीख, कक्षा, टेस्ट नं., विषय, सिलेबस/अध्याय, टेस्ट प्रकार)' }], warnings };
  const col = {};
  matrix[hi].forEach((c, i) => { const k = aliasKey(c); if (k && !(k in col)) col[k] = i; });
  for (const need of ['date', 'class', 'test_no', 'subject', 'syllabus']) {
    if (!(need in col)) errors.push({ row: hi + 1, message: `कॉलम नहीं मिला: ${need}` });
  }
  if (errors.length) return { rows: [], errors, warnings };
  const inHoliday = (d) => holidays.find((h) => d >= h.start_date && d <= h.end_date);
  const seen = new Set();
  const rows = [];
  for (let i = hi + 1; i < matrix.length; i++) {
    const r = matrix[i];
    if (r.every((c) => c === '' || c == null)) continue;
    const rowNo = i + 1;
    const get = (k) => (k in col ? r[col[k]] : '');
    const bad = (message) => errors.push({ row: rowNo, message });
    const date = toYmd(get('date'));
    const grade = parseInt(String(get('class')).replace(/\D/g, ''), 10);
    const testNo = parseInt(String(get('test_no')).replace(/\D/g, ''), 10);
    const subject = norm(get('subject'));
    const syllabus = norm(get('syllabus'));
    if (!date) bad('तारीख सही नहीं');
    if (!Number.isInteger(grade)) bad('कक्षा सही नहीं');
    if (!Number.isInteger(testNo)) bad('टेस्ट नं. सही नहीं');
    if (!subject) bad('विषय खाली');
    if (!syllabus) bad('सिलेबस खाली');
    if (!date || !Number.isInteger(grade) || !Number.isInteger(testNo) || !subject || !syllabus) continue;
    const key = `${grade}|${testNo}`;
    if (seen.has(key)) { bad(`कक्षा ${grade} का टेस्ट ${testNo} दोबारा है`); continue; }
    seen.add(key);
    const wd = weekday(date);
    if (![1, 3, 5].includes(wd)) warnings.push({ row: rowNo, message: `${date} सोम/बुध/शुक्र नहीं है` });
    const h = inHoliday(date);
    if (h) warnings.push({ row: rowNo, message: `${date} अवकाश में है${h.note ? ' (' + h.note + ')' : ''}` });
    const mm = Number(get('max_marks'));
    const du = Number(get('duration'));
    rows.push({
      seq: Number(get('seq')) || null, date, grade, test_no: testNo, subject, syllabus,
      type: norm(get('type')),
      max_marks: mm > 0 ? mm : null,
      duration_min: du > 0 ? Math.round(du) : null,
      status: STATUS_MAP[lc(get('status'))] || null,
    });
  }
  return { rows, errors, warnings };
}

module.exports = { norm, linkChapters, normalizeCalendarRows, ALIASES };
