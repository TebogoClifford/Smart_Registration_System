const express = require('express');
const cors = require('cors');
require('dotenv').config();
const pool = require('./db');

const venuesRouter = require('./routes/venues');
const devicesRouter = require('./routes/devices');
const studentsRouter = require('./routes/students');
const accessEventsRouter = require('./routes/accessEvents');
const statsRouter = require('./routes/stats');

const app = express();
app.use(cors());
app.use(express.json());

// Health check — useful for confirming the deploy pipeline works,
// and as a target for your pre-demo warm-up ping.
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Temporary Migration Routes
app.get('/api/admin/migrate-overrides', async (req, res) => {
  try {
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
    await pool.query(query);
    res.json({ status: 'success', message: 'event_overrides table created successfully' });
  } catch (err) {
    console.error('Migration error:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/api/admin/migrate-heartbeat', async (req, res) => {
  try {
    await pool.query('ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP WITH TIME ZONE');
    res.json({ status: 'success', message: 'last_seen column added successfully' });
  } catch (err) {
    console.error('Migration error:', err);
    res.status(500).json { status: 'error', message: err.message });
  }
});

app.use('/api/venues', venuesRouter);
app.use('/api/devices', devicesRouter);
app.use('/api/students', studentsRouter);
app.use('/api/access-events', accessEventsRouter);
app.use('/api/stats', statsRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});