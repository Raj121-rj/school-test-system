'use strict';
// Creating student accounts (shared by the Admin UI, Excel import and demo seeding).
const { hashPassword } = require('./auth');
const { randomPassword } = require('./util');

// c: transaction wrapper from db.tx. password/hash may be precomputed (hash outside the transaction).
async function createStudent(c, s) {
  const row = await c.one('INSERT INTO students (name, father_name, mother_name, dob, gender, is_demo) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [s.name, s.father_name || null, s.mother_name || null, s.dob || null, s.gender || null, !!s.is_demo]);
  const code = 'ST' + String(row.id).padStart(5, '0');
  const password = s.password || randomPassword(8);
  const hash = s.hash || (await hashPassword(password));
  const u = await c.one('INSERT INTO users (username, password_hash, role, full_name, must_change_password, is_demo) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [code.toLowerCase(), hash, 'student', s.name, !s.is_demo, !!s.is_demo]);
  await c.q('UPDATE students SET student_code = $1, user_id = $2 WHERE id = $3', [code, u.id, row.id]);
  await c.q('INSERT INTO student_class_history (student_id, session_id, class_id, roll_no, status) VALUES ($1,$2,$3,$4,$5)', [row.id, s.session_id, s.class_id, s.roll_no, 'active']);
  return { id: row.id, code, username: code.toLowerCase(), password };
}

module.exports = { createStudent };
