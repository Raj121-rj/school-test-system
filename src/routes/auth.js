'use strict';
const db = require('../db');
const { HttpError } = require('../http');
const A = require('../auth');
const { audit, getSettings, currentSession } = require('../core');

const pub = (u) => ({ id: u.id, username: u.username, role: u.role, full_name: u.full_name, must_change_password: !!u.must_change_password, teacher_id: u.teacher_id || null, student_id: u.student_id || null });

module.exports = function register(app) {
  app.post('/api/auth/login', async (req, res) => {
    const username = String(req.body.username || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!username || !password) throw new HttpError(400, 'यूज़रनेम और पासवर्ड लिखें');
    const key = `${req.ip}|${username}`;
    if (A.tooMany(key, 8) || A.tooMany(req.ip, 40)) throw new HttpError(429, 'बहुत ज़्यादा गलत प्रयास हुए। 15 मिनट बाद दोबारा कोशिश करें');
    const u = await db.one('SELECT id, username, role, full_name, active, must_change_password, password_hash FROM users WHERE username = $1', [username]);
    const ok = await A.verifyPassword(password, u ? u.password_hash : A.DUMMY);
    if (!u || !u.active || !ok) {
      A.failed(key);
      A.failed(req.ip);
      await audit(req, 'login_failed', 'user', null, { username });
      throw new HttpError(401, 'यूज़रनेम या पासवर्ड गलत है');
    }
    A.attempts.delete(key);
    await db.q('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [u.id]);
    A.setSession(req, res, u.id, u.password_hash);
    req.user = { id: u.id, username: u.username };
    await audit(req, 'login', 'user', u.id);
    res.json({ user: pub(u) });
  });

  app.post('/api/auth/logout', async (req, res) => {
    await A.loadUser(req);
    if (req.user) await audit(req, 'logout', 'user', req.user.id);
    A.clearSession(req, res);
    res.json({ ok: true });
  });

  // not an error when logged out: the page uses this to decide between the login screen and the dashboard
  app.get('/api/auth/me', async (req, res) => {
    const u = await A.loadUser(req);
    if (!u) return res.json({ user: null });
    const s = await getSettings();
    res.json({ user: pub(u), school_name: s.school_name || '', session: await currentSession() });
  });

  app.post('/api/auth/change-password', A.authAny, async (req, res) => {
    const cur = String(req.body.current_password || '');
    const nw = String(req.body.new_password || '');
    if (nw.length < 8) throw new HttpError(400, 'नया पासवर्ड कम से कम 8 अक्षरों का होना चाहिए');
    if (!/[A-Za-z\u0900-\u097F]/.test(nw) || !/\d/.test(nw)) throw new HttpError(400, 'पासवर्ड में अक्षर और अंक दोनों होने चाहिए');
    const row = await db.one('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!(await A.verifyPassword(cur, row.password_hash))) throw new HttpError(400, 'वर्तमान पासवर्ड गलत है');
    if (nw === cur) throw new HttpError(400, 'नया पासवर्ड पुराने से अलग होना चाहिए');
    const h = await A.hashPassword(nw);
    await db.q('UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2', [h, req.user.id]);
    A.setSession(req, res, req.user.id, h);
    await audit(req, 'password_change', 'user', req.user.id);
    res.json({ ok: true });
  });
};
