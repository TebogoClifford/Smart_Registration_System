const pool = require('./db');

async function migrateHeartbeat() {
  const client = await pool.connect();
  try {
    console.log('Starting migration: Add last_seen to devices...');
    await client.query('ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP WITH TIME ZONE');
    console.log('✅ Migration successful: last_seen column added.');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
}

migrateHeartbeat();
