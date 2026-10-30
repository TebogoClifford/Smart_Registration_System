// createUser.js — create an account from the command line (e.g. the first invigilator).
//   npm run create-user -- <email> "<Full Name>" <password> [admin|invigilator]
// It talks to whatever database DATABASE_URL points at, so run it deliberately.
// The password given here is the person's own (no forced change at first sign-in).
require('dotenv').config({ quiet: true });
const prisma = require('./db');
const { hashPassword } = require('./auth');

async function main() {
  const [emailArg, name, password, role = 'invigilator'] = process.argv.slice(2);
  if (!emailArg || !name || !password) {
    console.error('Usage: npm run create-user -- <email> "<Full Name>" <password> [admin|invigilator]');
    process.exit(1);
  }
  if (!['admin', 'invigilator'].includes(role)) { console.error('role must be admin or invigilator'); process.exit(1); }
  if (password.length < 8) { console.error('password must be at least 8 characters'); process.exit(1); }
  const email = emailArg.trim().toLowerCase();
  if (await prisma.users.findUnique({ where: { email }, select: { id: true } })) {
    console.log(`An account for ${email} already exists; nothing changed.`);
    return;
  }
  const user = await prisma.users.create({
    data: { email, name: name.trim(), password_hash: await hashPassword(password), role },
    select: { id: true },
  });
  console.log(`Created ${role} ${email} (id ${user.id})`);
}

main()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
