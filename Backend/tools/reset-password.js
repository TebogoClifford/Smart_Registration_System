// reset-password.js — set a new password for an existing account from the command line.
//   node tools/reset-password.js <email> <new-password>
// It talks to whatever database DATABASE_URL points at, so run it deliberately.
// The password set here is the person's own (no forced change at the next sign-in).
require('dotenv').config({ quiet: true });
const prisma = require('../src/db');
const { hashPassword } = require('../src/auth');

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.log('Usage: node tools/reset-password.js <email> <new-password>');
    process.exit(1);
  }
  if (password.length < 8) { console.error('password must be at least 8 characters'); process.exit(1); }
  const { count } = await prisma.users.updateMany({
    where: { email: email.trim().toLowerCase() },
    data: { password_hash: await hashPassword(password), must_change_password: false },
  });
  if (count === 0) { console.error(`No account with email ${email}.`); process.exitCode = 1; }
  else console.log(`✅ Password reset for ${email}`);
}

main()
  .catch((err) => { console.error('Password reset failed:', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
