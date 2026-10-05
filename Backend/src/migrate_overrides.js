const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Starting migration: Create event_overrides table...');

    const query = `
      CREATE TABLE IF NOT EXISTS event_overrides (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES access_events(id) ON DELETE CASCADE,
        invigilator_id VARCHAR(255) NOT NULL,
        reason TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_overrides_event_id ON event_overrides(event_id);
    `;

    await client.query(query);
    console.log('✅ Migration successful: event_overrides table is ready.');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
}

migrate();
