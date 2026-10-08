'use strict';
const assert = require('assert');
const path = require('path');
const { normalizeCalendarRows, linkChapters } = require('../src/calendar');
const { validateStudents } = require('../src/importer');
const A = require('../src/analytics');
const cal = require(path.join(__dirname, '../data/master_calendar.json'));
const chapters = require(path.join(__dirname, '../data/chapters.json'));
const HOLIDAYS = [{ start_date: '2026-10-19', end_date: '2026-10-19', note: 'अवकाश' }, { start_date: '2026-11-05', end_date: '2026-11-11', note: 'दीपावली अवकाश' }, { start_date: '2027-01-03', end_date: '2027-01-10', note: 'शीतकालीन अवकाश' }];

module.exports = async function (t) {
  await t('calendar: 192 tests, 48 dates, only Mon/Wed/Fri, no holidays', () => {
    const matrix = [['क्रम', 'तारीख', 'दिन', 'कक्षा', 'टेस्ट नं.', 'विषय', 'सिलेबस/अध्याय', 'टेस्ट प्रकार']].concat(
      cal.map((r) => [r.seq, new Date(r.date + 'T00:00:00Z'), r.day, r.class, r.test_no, r.subject, r.syllabus, r.type]));
    const out = normalizeCalendarRows(matrix, { holidays: HOLIDAYS });
    assert.deepStrictEqual(out.errors, []);
    assert.deepStrictEqual(out.warnings, []);
    assert.strictEqual(out.rows.length, 192);
    const dates = [...new Set(out.rows.map((r) => r.date))].sort();
    assert.strictEqual(dates.length, 48);
    assert.strictEqual(dates[0], '2026-10-12');
    assert.strictEqual(dates[47], '2027-02-15');
    for (const g of [5, 8, 10, 12]) assert.strictEqual(out.rows.filter((r) => r.grade === g).length, 48);
  });

  await t('calendar: every syllabus unit links to chapters; all chapters covered', () => {
    const covered = {};
    let unmatched = [];
    for (const r of cal) {
      const titles = chapters[r.class][r.subject];
      assert.ok(titles, `no chapters for ${r.class}/${r.subject}`);
      const l = linkChapters(titles, r.syllabus);
      unmatched = unmatched.concat(l.unmatched.map((u) => `${r.class}/${r.subject}/T${r.test_no}: ${u}`));
      if (r.syllabus.startsWith('पूर्ण पाठ्यक्रम')) { assert.ok(l.full && !l.chapters.length); continue; }
      assert.ok(l.chapters.length >= 1, `${r.class}/${r.subject}/T${r.test_no} has no chapters`);
      if (r.type === 'अध्याय आधारित') {
        const k = r.class + '|' + r.subject;
        (covered[k] = covered[k] || new Set());
        l.chapters.forEach((c) => covered[k].add(c));
      }
    }
    assert.deepStrictEqual(unmatched, []);
    for (const g of Object.keys(chapters)) for (const s of Object.keys(chapters[g])) {
      assert.strictEqual(covered[g + '|' + s].size, chapters[g][s].length, `chapter coverage ${g}/${s}`);
    }
  });

  await t('calendar: grouped Class-12 Hindi units and duplicate titles resolve correctly', () => {
    const hc = chapters['12']['हिंदी अनिवार्य'];
    assert.deepStrictEqual(linkChapters(hc, 'अध्याय 8–10: आत्मपरिचय, एक गीत | पतंग | कविता के बहाने, बात सीधी थी पर').chapters, [8, 9, 10, 11, 12]);
    assert.deepStrictEqual(linkChapters(hc, 'अध्याय 14–17: कवितावली, लक्ष्मण-मूर्छा और राम का विलाप | रुबाइयाँ, गज़ल | छोटा मेरा खेत, बगुलों के पंख | सिल्वर वेडिंग').chapters, [16, 17, 18, 19, 20, 21, 22]);
    const geo = chapters['12']['भूगोल'];
    assert.deepStrictEqual(linkChapters(geo, 'अध्याय 16–17: अंतर्राष्ट्रीय व्यापार | भौगोलिक परिप्रेक्ष्य में चयनित कुछ मुद्दे एवं समस्याएँ').chapters, [16, 17]);
    assert.deepStrictEqual(linkChapters(geo, 'अध्याय 8–10: अंतर्राष्ट्रीय व्यापार | जनसंख्या : वितरण, घनत्व, वृद्धि और संगठन | मानव बस्तियाँ').chapters, [8, 9, 10]);
    const sh = chapters['12']['हिंदी साहित्य'];
    assert.deepStrictEqual(linkChapters(sh, 'अध्याय 1–3: जयशंकर प्रसाद — देवसेना का गीत, कार्नेलिया का गीत | निराला — सरोज स्मृति | अज्ञेय — यह दीप अकेला, मैंने देखा एक बूँद').chapters, [1, 2, 3, 4, 5]);
  });

  await t('calendar: bad rows are reported with row numbers', () => {
    const m = [['तारीख', 'कक्षा', 'टेस्ट नं.', 'विषय', 'सिलेबस'], ['2026-10-12', 5, 1, 'हिंदी', 'अध्याय 1–1: x'], ['31-02-2026', 5, 2, 'हिंदी', 'y'], ['2026-10-14', 5, 1, 'हिंदी', 'dup']];
    const o = normalizeCalendarRows(m);
    assert.strictEqual(o.rows.length, 1);
    assert.deepStrictEqual(o.errors.map((e) => e.row), [3, 4]);
  });

  await t('import: validation finds duplicates, blanks, bad values with row numbers', () => {
    const m = [['Roll No.', 'Student Name', 'Father Name', 'Mother Name', 'DOB', 'Gender'],
      [1, 'आरव', 'पिता', 'माता', '2015-06-15', 'M'],
      [2, '', 'x', 'y', '2015-01-01', 'F'],
      [1, 'दोहरा', '', '', '', 'F'],
      [3, 'तीन', '', '', '31-02-2015', 'F'],
      [4, 'चार', '', '', '15/08/2014', 'लड़की'],
      [5, 'पाँच', '', '', '', 'X'],
      [9, 'मौजूद', '', '', '', ''],
      ['', '', '', '', '', '']];
    const r = validateStudents(m, new Set([9]), { today: '2026-10-07' });
    assert.strictEqual(r.summary.total, 7);
    assert.strictEqual(r.summary.valid, 2);
    assert.strictEqual(r.summary.invalid, 5);
    assert.strictEqual(r.summary.duplicateRolls, 2);
    assert.strictEqual(r.summary.blankNames, 1);
    assert.deepStrictEqual(r.valid.map((v) => v.roll_no), [1, 4]);
    assert.strictEqual(r.valid[1].dob, '2014-08-15');
    assert.strictEqual(r.valid[1].gender, 'F');
    assert.ok(r.errors.some((e) => e.row === 4 && /पंक्ति 2|पंक्ति 1/.test(e.message) || e.row === 4));
  });

  await t('analytics: trend needs enough data and uses recent vs earlier tests', () => {
    assert.strictEqual(A.trendOf([50, 60, 70]).label, 'insufficient');
    assert.strictEqual(A.trendOf([40, 42, 41, 60, 65, 70]).label, 'improving');
    assert.strictEqual(A.trendOf([80, 78, 82, 60, 55, 50]).label, 'declining');
    assert.strictEqual(A.trendOf([60, 61, 59, 60, 62, 60]).label, 'stable');
  });

  await t('analytics: summary, subjects, absent handling and class analysis', () => {
    const mk = (sid, tid, sub, no, date, marks, status = 'present') => A.enrich({ student_id: sid, test_id: tid, subject_id: sub, subject_name: 'S' + sub, test_no: no, test_date: date, max_marks: 20, marks, status });
    const recs = [mk(1, 1, 1, 1, '2026-10-12', 10), mk(1, 2, 2, 2, '2026-10-14', 20), mk(1, 3, 1, 3, '2026-10-16', null, 'absent'), mk(1, 4, 2, 4, '2026-10-21', 18)];
    const s = A.summarize(recs, 5);
    assert.strictEqual(s.given, 3); assert.strictEqual(s.absent, 1); assert.strictEqual(s.held, 5);
    assert.strictEqual(s.avg, 80); assert.strictEqual(s.highest, 100); assert.strictEqual(s.lowest, 50);
    assert.strictEqual(s.best.subject, 'S2'); assert.strictEqual(s.weakest.subject, 'S1');
    assert.strictEqual(s.trend, 'insufficient'); assert.strictEqual(s.recent.length, 3);
    const tests = [1, 2, 3, 4].map((i) => ({ id: i, test_code: 'T' + i, test_no: i, test_date: '2026-10-1' + i, subject_id: 1, subject_name: 'S1', syllabus: '' }));
    const weak = [1, 2, 3, 4].map((i) => mk(2, i, 1, i, '2026-10-1' + i, 4));
    const out = A.classAnalysis({ students: [{ id: 1, name: 'A', roll_no: 1 }, { id: 2, name: 'B', roll_no: 2 }], tests, recs: recs.concat(weak), settings: {} });
    assert.strictEqual(out.attention.length, 1); assert.strictEqual(out.attention[0].name, 'B');
    assert.strictEqual(out.top[0].name, 'A'); assert.strictEqual(out.perTest.length, 4);
  });
};
