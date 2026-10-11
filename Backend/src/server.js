const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { trimBody } = require('./http');
const { ensureSchema } = require('./schema');
const venuesRouter = require('./routes/venues');
const devicesRouter = require('./routes/devices');
const studentsRouter = require('./routes/students');
const accessEventsRouter = require('./routes/accessEvents');
const statsRouter = require('./routes/stats');

const app = express();
app.use(cors());
app.use(express.json());
app.use(trimBody);

// Health check — useful for confirming the deploy pipeline works,
// and as a target for your pre-demo warm-up ping.
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/venues', venuesRouter);
app.use('/api/devices', devicesRouter);
app.use('/api/students', studentsRouter);
app.use('/api/access-events', accessEventsRouter);
app.use('/api/stats', statsRouter);

// Unknown routes -> JSON 404; unexpected errors (e.g. malformed JSON body) -> JSON, never an HTML stack trace
app.use((req, res) => res.status(404).json({ error: 'not found' }));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON body' });
  console.error(err);
  res.status(500).json({ error: 'internal server error' });
});

// Bring the database up to date (Neon may take a few seconds to wake up), then start listening.
async function start() {
  for (let attempt = 1; ; attempt++) {
    try {
      await ensureSchema();
      break;
    } catch (err) {
      if (attempt >= 5) { console.error('Could not prepare the database:', err); process.exit(1); }
      console.warn(`Database not ready (attempt ${attempt}/5): ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  const PORT = process.env.PORT || 3000;
  // Express 5 passes a startup error (e.g. port already in use) to this callback instead of throwing,
  // so check it, otherwise the log would say "listening" while nothing is.
  app.listen(PORT, (err) => {
    if (err) { console.error(`Could not listen on port ${PORT}:`, err); process.exit(1); }
    console.log(`Backend listening on port ${PORT}`);
  });
}

start();
