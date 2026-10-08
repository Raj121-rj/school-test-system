'use strict';
const crypto = require('crypto');
const { HttpError } = require('./http');

const pad2 = (n) => String(n).padStart(2, '0');
const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: process.env.SCHOOL_TZ || 'Asia/Kolkata' });
const asInt = (v, name = 'id') => {
  const n = Number(v);
  if (v === '' || v == null || !Number.isInteger(n) || n < 0) throw new HttpError(400, `${name} गलत है`);
  return n;
};
const inList = (arr, start = 1) => arr.map((_, i) => '$' + (start + i)).join(',');
const PW_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const randomPassword = (len = 8) => Array.from({ length: len }, () => PW_CHARS[crypto.randomInt(PW_CHARS.length)]).join('');
const csvCell = (v) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const toCsv = (columns, rows) => '\uFEFF' + [columns, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');

// Validated YYYY-MM-DD or null
function ymd(y, m, d) {
  const s = `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
  const dt = new Date(s + 'T00:00:00Z');
  return Number.isNaN(dt.getTime()) || dt.getUTCMonth() + 1 !== Number(m) || dt.getUTCDate() !== Number(d) ? null : s;
}
// Accepts Date (UTC-based, as produced by exceljs), YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY
function toYmd(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : ymd(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return ymd(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return ymd(m[3], m[2], m[1]);
  return null;
}
const weekday = (s) => new Date(s + 'T00:00:00Z').getUTCDay(); // 0 = Sunday

module.exports = { pad2, todayStr, asInt, inList, randomPassword, csvCell, toCsv, ymd, toYmd, weekday };
