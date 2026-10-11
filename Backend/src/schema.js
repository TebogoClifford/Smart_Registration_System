// schema.js — idempotent schema setup, run on every server start (and by `npm run migrate`).
// Every statement uses IF NOT EXISTS, so running it twice, or on a database that already has
// some of these changes, is safe. This replaces having to remember to run migration scripts.
const pool = require('./db');

const STATEMENTS = [
  // --- earlier migrations (previously migrate_heartbeat.js / migrate_overrides.js)
  `ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP WITH TIME ZONE`,
  `CREATE TABLE IF NOT EXISTS event_overrides (
     id SERIAL PRIMARY KEY,
     event_id INTEGER NOT NULL REFERENCES access_events(id) ON DELETE CASCADE,
     invigilator_id VARCHAR(255) NOT NULL,
     reason TEXT NOT NULL,
     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE INDEX IF NOT EXISTS idx_overrides_event_id ON event_overrides(event_id)`,

  // --- invigilator accounts
  `CREATE TABLE IF NOT EXISTS users (
     id SERIAL PRIMARY KEY,
     email VARCHAR(255) NOT NULL UNIQUE,
     name VARCHAR(100) NOT NULL,
     password_hash TEXT NOT NULL,
     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
   )`,

  // --- device API: duplicate-proof event uploads (device retries after a WiFi drop)
  `ALTER TABLE access_events ADD COLUMN IF NOT EXISTS client_event_id VARCHAR(64)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_events_device_client_id
     ON access_events (device_id, client_event_id) WHERE client_event_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_events_time ON access_events (event_time DESC)`,

  // --- device API: when enrollment was requested, so abandoned requests expire
  `ALTER TABLE students ADD COLUMN IF NOT EXISTS enrollment_requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()`,
];

async function ensureSchema() {
  const client = await pool.connect();
  try {
    // advisory lock: two instances starting together will not race on CREATE TABLE
    await client.query('SELECT pg_advisory_lock(727001)');
    for (const sql of STATEMENTS) await client.query(sql);
  } finally {
    await client.query('SELECT pg_advisory_unlock(727001)').catch(() => {});
    client.release();
  }
}

module.exports = { ensureSchema };
