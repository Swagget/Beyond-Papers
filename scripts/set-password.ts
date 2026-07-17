// One-off password reset, safe to run on a live instance (e.g. via `fly ssh console`).
//
// Run: SET_USER=admin SET_PASSWORD='new-secret' npx tsx scripts/set-password.ts
//
// Credentials come from env vars, not argv, so they don't leak into shell
// history/process listings when run through `fly ssh console -C`.

import { db } from '../server/src/db.js';
import { hashPassword } from '../server/src/lib/auth.js';

const username = process.env.SET_USER;
const password = process.env.SET_PASSWORD;

if (!username || !password) {
  console.error('Usage: SET_USER=<username> SET_PASSWORD=<password> npx tsx scripts/set-password.ts');
  process.exit(1);
}

const res = db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hashPassword(password), username);
if (res.changes === 0) {
  console.error(`No user named '${username}'.`);
  process.exit(1);
}

// Invalidate sessions created under the old password.
db.prepare('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)').run(username);

console.log(`Password updated for '${username}'; existing sessions invalidated.`);
