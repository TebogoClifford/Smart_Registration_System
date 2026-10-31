// deploy.js — `npm start` / `npm run migrate`: bring the database up to date with Prisma Migrate.
//
// A database created before Prisma (like the live Neon one) has tables but no migration history,
// and `prisma migrate deploy` refuses it (error P3005). The first time that happens this script
// "baselines" it: it runs the idempotent 0_init SQL (adds anything missing, changes nothing else),
// records 0_init as applied, and then deploys any later migrations as usual.
require('dotenv').config({ quiet: true }); // local runs read DATABASE_URL from .env (Render sets it directly)
const { spawnSync } = require('child_process');

const BASELINE = '0_init';
const CLI = require.resolve('prisma/build/index.js'); // the Prisma CLI, run with this same Node (no shell)

// Prisma Migrate holds a Postgres advisory lock while it works, which does not survive Neon's
// connection pooler (the "-pooler" host): the deploy then fails with P1002 (lock timeout). So the
// migration runs over the direct host (same address without "-pooler"), or DIRECT_URL if set.
// The app itself keeps using DATABASE_URL (the pooler).
const directUrl = process.env.DIRECT_URL || (process.env.DATABASE_URL || '').replace(/(@[^/?]*?)-pooler\./, '$1.');
const env = { ...process.env, ...(directUrl && { DATABASE_URL: directUrl }) };
if (directUrl && directUrl !== process.env.DATABASE_URL) console.log('Migrating over the direct database connection (not the pooler).');

// Run one Prisma CLI command. A sleeping Neon database answers "can't reach" (P1001) while it wakes,
// and a busy lock times out (P1002); both are retried a few times. If the lock stays taken (an older
// run through the pooler can leave it held by an idle pooled connection), the last tries migrate
// without the lock: only one server runs migrations here, so it is not needed.
function prisma(args) {
  for (let attempt = 1; ; attempt++) {
    const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env });
    const out = `${r.stdout}${r.stderr}`;
    if (r.status !== 0 && /P1001|P1002/.test(out) && attempt < 5) {
      const locked = out.includes('P1002');
      console.log(`Database not ready (${locked ? 'migration lock is taken' : 'waking up'}), attempt ${attempt}/5, trying again...`);
      if (locked && attempt >= 2 && !env.PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK) {
        console.log('The migration lock is held by another connection; migrating without the lock (single server).');
        env.PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK = '1';
      }
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
