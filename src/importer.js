'use strict';
// Student Excel import: validation only (parsing the .xlsx file happens in excel.js)
const { toYmd } = require('./util');

const clean = (v) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
const lc = (v) => clean(v).toLowerCase();
const HEADS = {
  roll: ['roll no.', 'roll no', 'roll', 'roll number', 'रोल नं.', 'रोल नं', 'रोल नंबर'],
  name: ['student name', 'name', 'नाम', 'विद्यार्थी का नाम', 'छात्र का नाम'],
  father: ['father name', "father's name", 'पिता का नाम', 'पिता'],
  mother: ['mother name', "mother's name", 'माता का नाम', 'माता'],
  dob: ['dob', 'date of birth', 'जन्म तिथि', 'जन्मतिथि'],
  gender: ['gender', 'sex', 'लिंग'],
};
const MALE = ['m', 'male', 'boy', 'पु', 'पुरुष', 'लड़का', 'बालक'];
const FEMALE = ['f', 'female', 'girl', 'म', 'महिला', 'लड़की', 'बालिका'];

function normalizeGender(v) {
  const s = lc(v);
  if (!s) return '';
  if (MALE.includes(s)) return 'M';
  if (FEMALE.includes(s)) return 'F';
  if (['o', 'other', 'अन्य'].includes(s)) return 'O';
  return null;
}

// matrix: array of arrays; existingRolls: Set<number> of active roll numbers already in the class
function validateStudents(matrix, existingRolls = new Set(), { today = new Date().toISOString().slice(0, 10) } = {}) {
  const map = { roll: 0, name: 1, father: 2, mother: 3, dob: 4, gender: 5 };
  let start = 0;
  const head = (matrix[0] || []).map(lc);
  if (head.some((h) => HEADS.roll.includes(h) || HEADS.name.includes(h))) {
    start = 1;
    for (const [k, list] of Object.entries(HEADS)) { const i = head.findIndex((h) => list.includes(h)); if (i >= 0) map[k] = i; }
  }
  const summary = { total: 0, valid: 0, invalid: 0, duplicateRolls: 0, blankNames: 0, invalidValues: 0 };
  const valid = [];
  const errors = [];
  const seen = new Map();
  for (let i = start; i < matrix.length; i++) {
    const r = matrix[i] || [];
    if (r.every((c) => c === '' || c == null)) continue;
    const row = i + 1;
    summary.total++;
    const errs = [];
    const rollRaw = clean(r[map.roll]);
    const roll = Number(rollRaw);
    const name = clean(r[map.name]);
    if (!rollRaw || !Number.isInteger(roll) || roll <= 0 || roll > 9999) { errs.push('रोल नं. सही संख्या होनी चाहिए'); summary.invalidValues++; }
    else if (seen.has(roll)) { errs.push(`रोल नं. ${roll} फ़ाइल में पंक्ति ${seen.get(roll)} पर भी है`); summary.duplicateRolls++; }
    else if (existingRolls.has(roll)) { errs.push(`रोल नं. ${roll} इस कक्षा में पहले से मौजूद है`); summary.duplicateRolls++; }
    if (Number.isInteger(roll) && roll > 0 && !seen.has(roll)) seen.set(roll, row);
    if (!name) { errs.push('नाम खाली है'); summary.blankNames++; }
    else if (name.length > 100) { errs.push('नाम बहुत लंबा है'); summary.invalidValues++; }
    const dobRaw = r[map.dob];
    let dob = '';
    if (dobRaw !== '' && dobRaw != null && clean(dobRaw) !== '') {
      dob = toYmd(dobRaw);
      if (!dob || dob >= today) { errs.push('जन्मतिथि सही नहीं (YYYY-MM-DD या DD-MM-YYYY)'); summary.invalidValues++; dob = ''; }
    }
    const gender = normalizeGender(r[map.gender]);
    if (gender === null) { errs.push('लिंग M / F लिखें'); summary.invalidValues++; }
    if (errs.length) { summary.invalid++; errs.forEach((m) => errors.push({ row, message: m })); }
    else valid.push({ row, roll_no: roll, name, father_name: clean(r[map.father]), mother_name: clean(r[map.mother]), dob: dob || null, gender: gender || null });
  }
  summary.valid = valid.length;
  return { valid, errors, summary };
}

module.exports = { validateStudents, normalizeGender, HEADS };
