// createUser.js — create an account from the command line (e.g. the first invigilator).
//   npm run create-user -- <email> "<Full Name>" <password> [admin|invigilator]
// It talks to whatever database DATABASE_URL points at, so run it deliberately.
require('dotenv').config();
const pool = require('./db');
const { ensureSchema } = require('./schema');
const { hashPassword } = require('./auth');

async function main() {
  const [emailArg, name, password, role = 'invigilator'] = process.argv.slice(2);
  if (!emailArg || !name || !password) {
    console.error('Usage: npm run create-user -- <email> "<Full Name>" <password> [admin|invigilator]');
    process.exit(1);
  }
  if (!['admin', 'invigilator'].includes(role)) { console.error('role must be admin or invigilator'); process.exit(1); }
  if (password.length < 8) { console.error('password must be at least 8 characters'); process.exit(1); }
  await ensureSchema();
  const email = emailArg.trim().toLowerCase();
  const { rows } = await pool.query(
    `INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO NOTHING RETURNING id`,
    [email, name.trim(), await hashPassword(password), role]
  );
  console.log(rows.length ? `Created ${role} ${email} (id ${rows[0].id})` : `An account for ${email} already exists; nothing changed.`);
  await pool.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
