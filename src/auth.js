'use strict';
// Authentication: scrypt password hashes, signed cookie sessions, role middleware, login rate-limit.
const crypto = require('crypto');
const db = require('./db');
const { HttpError } = require('./http');

const isProd = process.env.NODE_ENV === 'production';
let SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  if (isProd) throw new Error('JWT_SECRET सेट करना ज़रूरी है (production)');
  SECRET = 'dev-only-secret-change-me';
}
const COOKIE = 'sts_session';
const TTL = 12 * 60 * 60; // 12 hours

const scrypt = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))));
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${(await scrypt(pw, salt)).toString('hex')}`;
}
const DUMMY = `scrypt$${'00'.repeat(16)}$${'00'.repeat(64)}`;
async function verifyPassword(pw, stored) {
  const [alg, s, k] = String(stored).split('$');
  if (alg !== 'scrypt' || !s || !k) return false;
  const key = await scrypt(pw, Buffer.from(s, 'hex'));
  const exp = Buffer.from(k, 'hex');
  return exp.length === key.length && crypto.timingSafeEqual(exp, key);
}

function signToken(payload, ttl = TTL) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttl })).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', SECRET).update(body).digest('base64url')}`;
}
function verifyToken(tok) {
  if (typeof tok !== 'string') return null;
  const [body, sig] = tok.split('.');
  if (!body || !sig) return null;
  const exp = crypto.createHmac('sha256', SECRET).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== exp.length || !crypto.timingSafeEqual(got, exp)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p.exp > Date.now() / 1000 ? p : null;
  } catch (_) { return null; }
}

async function loadUser(req) {
  if (req.user !== undefined) return req.user;
  req.user = null;
  const p = verifyToken(req.cookies && req.cookies[COOKIE]);
  if (!p) return null;
  const u = await db.one(
    `SELECT u.id, u.username, u.role, u.full_name, u.active, u.must_change_password, u.password_hash, t.id AS teacher_id, s.id AS student_id
     FROM users u LEFT JOIN teachers t ON t.user_id = u.id LEFT JOIN students s ON s.user_id = u.id WHERE u.id = $1`, [p.uid]);
  if (!u || !u.active || p.ph !== u.password_hash.slice(-12)) return null;
  delete u.password_hash;
  req.user = u;
  return u;
}
// any logged-in user (even if a password change is pending)
async function authAny(req) {
  if (!(await loadUser(req))) throw new HttpError(401, 'कृपया लॉगिन करें');
}
async function requireAuth(req) {
  await authAny(req);
  if (req.user.must_change_password) throw new HttpError(403, 'पहले अपना पासवर्ड बदलें');
}
const requireRole = (...roles) => async (req) => {
  await requireAuth(req);
  if (!roles.includes(req.user.role)) throw new HttpError(403, 'आपको इसकी अनुमति नहीं है');
};

function setSession(req, res, userId, passwordHash) {
  res.cookie(COOKIE, signToken({ uid: userId, ph: passwordHash.slice(-12) }), { maxAge: TTL, secure: req.secure || isProd });
}
function clearSession(req, res) {
  res.cookie(COOKIE, '', { maxAge: 0, secure: req.secure || isProd });
}

// simple in-memory login throttle
const attempts = new Map();
const tooMany = (key, limit) => {
  const a = attempts.get(key);
  if (!a) return false;
  if (Date.now() - a.t > 15 * 60 * 1000) { attempts.delete(key); return false; }
  return a.n >= limit;
};
const failed = (key) => {
  const a = attempts.get(key);
  if (!a || Date.now() - a.t > 15 * 60 * 1000) attempts.set(key, { n: 1, t: Date.now() });
  else a.n++;
};
const resetAttempts = () => attempts.clear();

module.exports = { hashPassword, verifyPassword, DUMMY, signToken, verifyToken, loadUser, authAny, requireAuth, requireRole, setSession, clearSession, tooMany, failed, attempts, resetAttempts, COOKIE };
