// schema.js — idempotent schema setup, run every time the server starts (and by `npm run migrate`).
// Every statement uses IF NOT EXISTS, so running it twice, or on a database that already has these
// changes, does nothing. This replaces the old public /api/admin/migrate-* URLs (removed for
// security) so the live database can never fall behind the code again.
const pool = require('./db');

const STATEMENTS = [
  // devices.last_seen — set by the device heartbeat; drives the online/offline status
  `ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP WITH TIME ZONE`,

  // audit trail of manual invigilator overrides of an access decision
  `CREATE TABLE IF NOT EXISTS event_overrides (
     id SERIAL PRIMARY KEY,
     event_id INTEGER NOT NULL REFERENCES access_events(id) ON DELETE CASCADE,
     invigilator_id VARCHAR(255) NOT NULL,
     reason TEXT NOT NULL,
     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE INDEX IF NOT EXISTS idx_overrides_event_id ON event_overrides(event_id)`,
];

async function ensureSchema() {
  const client = await pool.connect();
  try {
    // advisory lock: two server instances starting together will not race on CREATE TABLE
    await client.query('SELECT pg_advisory_lock(727001)');
    for (const sql of STATEMENTS) await client.query(sql);
  } finally {
    await client.query('SELECT pg_advisory_unlock(727001)').catch(() => {});
    client.release();
  }
}

module.exports = { ensureSchema };
