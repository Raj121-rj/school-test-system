'use strict';
// Forgot the admin password?  node scripts/reset-admin.js "NewPassword123" [admin-username]
const db = require('../src/db');
const { hashPassword } = require('../src/auth');

(async () => {
  const pw = process.argv[2];
  const user = String(process.argv[3] || process.env.ADMIN_USERNAME || 'admin').toLowerCase();
  if (!pw || pw.length < 8) { console.error('Usage: node scripts/reset-admin.js "<new password, 8+ characters>" [admin-username]'); process.exit(1); }
  await db.init();
  const u = await db.one("SELECT id FROM users WHERE username = $1 AND role = 'admin'", [user]);
  if (!u) { console.error(`Admin user "${user}" not found`); process.exit(1); }
  await db.q('UPDATE users SET password_hash = $1, must_change_password = false, active = true WHERE id = $2', [await hashPassword(pw), u.id]);
  console.log(`Password updated for admin "${user}". Login with the new password.`);
  await db.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
