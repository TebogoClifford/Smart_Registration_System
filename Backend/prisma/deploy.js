// deploy.js — `npm start` / `npm run migrate`: bring the database up to date with Prisma Migrate.
//
// A database created before Prisma (like the live Neon one) has tables but no migration history,
// and `prisma migrate deploy` refuses it (error P3005). The first time that happens this script
// "baselines" it: it runs the idempotent 0_init SQL (adds anything missing, changes nothing else),
// records 0_init as applied, and then deploys any later migrations as usual.
const { spawnSync } = require('child_process');

const BASELINE = '0_init';
const CLI = require.resolve('prisma/build/index.js'); // the Prisma CLI, run with this same Node (no shell)

// Run one Prisma CLI command. A sleeping Neon database answers "can't reach" (P1001) while it wakes,
// so that error is retried a few times.
function prisma(args) {
  for (let attempt = 1; ; attempt++) {
    const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
    const out = `${r.stdout}${r.stderr}`;
    if (r.status !== 0 && out.includes('P1001') && attempt < 5) {
      console.log(`Database not reachable yet (attempt ${attempt}/5), waiting for it to wake up...`);
      spawnSync(process.execPath, ['-e', `setTimeout(() => {}, ${3000 * attempt})`]);
      continue;
    }
    process.stdout.write(r.stdout || '');
    process.stderr.write(r.stderr || '');
    if (r.status !== 0 && out.includes('P1001') && /sslmode=verify-full/.test(process.env.DATABASE_URL || '')) {
      console.error('Prisma Migrate cannot connect with sslmode=verify-full: use sslmode=require in DATABASE_URL.');
    }
    return { ok: r.status === 0, out };
  }
}

let r = prisma(['migrate', 'deploy']);
if (!r.ok && r.out.includes('P3005')) {
  console.log(`\nExisting database without migration history: baselining with ${BASELINE}.`);
  const steps = [
    ['db', 'execute', '--file', `prisma/migrations/${BASELINE}/migration.sql`],
    ['migrate', 'resolve', '--applied', BASELINE],
  ];
  for (const step of steps) {
    if (!prisma(step).ok) { console.error(`prisma ${step.join(' ')} failed`); process.exit(1); }
  }
  r = prisma(['migrate', 'deploy']);
}
if (!r.ok) { console.error('Database migration failed.'); process.exit(1); }
