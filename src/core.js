'use strict';
// Shared helpers for routes: audit log, settings, current session, teacher scope, table export.
const db = require('./db');
const { HttpError } = require('./http');
const { toCsv } = require('./util');

async function audit(req, action, entity = null, entityId = null, details = null) {
  const u = (req && req.user) || {};
  try {
    await db.q('INSERT INTO audit_logs (user_id, username, action, entity, entity_id, details, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [u.id || null, u.username || (details && details.username) || null, action, entity, entityId == null ? null : String(entityId), details ? JSON.stringify(details) : null, (req && req.ip) || null]);
  } catch (e) { console.error('[audit]', e.message); }
}
async function getSettings() {
  return Object.fromEntries((await db.all('SELECT key, value FROM settings')).map((r) => [r.key, r.value]));
}
const setSetting = (key, value) => db.q('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, String(value)]);
async function currentSession() {
  const s = await db.one('SELECT id, name FROM sessions WHERE is_current = true ORDER BY id DESC LIMIT 1');
  if (!s) throw new HttpError(500, 'कोई चालू सत्र नहीं है');
  return s;
}
// subjects a teacher is assigned to (one row per class+subject)
const teacherSubjects = (user) => db.all(
  `SELECT sb.id AS subject_id, sb.name AS subject, c.id AS class_id, c.grade, c.name AS class_name
   FROM teacher_assignments ta JOIN subjects sb ON sb.id = ta.subject_id JOIN classes c ON c.id = sb.class_id
   WHERE ta.teacher_id = $1 ORDER BY c.grade, sb.name`, [user.teacher_id]);

const attach = (fn) => `attachment; filename="${fn.replace(/[^\w.-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fn)}`;
async function sendTable(res, format, name, { title, columns, rows, meta }) {
  if (format === 'csv') return res.send(toCsv(columns, rows), 'text/csv; charset=utf-8', 200, { 'Content-Disposition': attach(name + '.csv') });
  if (format === 'xlsx') {
    const { toXlsx } = require('./excel');
    return res.send(await toXlsx(title || name, columns, rows), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 200, { 'Content-Disposition': attach(name + '.xlsx') });
  }
  return res.json({ title, columns, rows, meta: meta || {} });
}

module.exports = { audit, getSettings, setSetting, currentSession, teacherSubjects, sendTable };
