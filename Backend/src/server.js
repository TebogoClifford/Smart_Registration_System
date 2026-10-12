const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { trimBody } = require('./http');
const { ensureSchema } = require('./schema');
const auth = require('./auth');
const venuesRouter = require('./routes/venues');
const devicesRouter = require('./routes/devices');
const studentsRouter = require('./routes/students');
const accessEventsRouter = require('./routes/accessEvents');
const statsRouter = require('./routes/stats');
const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const modulesRouter = require('./routes/modules');
const bookingsRouter = require('./routes/bookings');

const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy; this makes req.ip the real client address
// CORS_ORIGIN (comma-separated) limits which websites may call the API from a browser.
// Unset = any origin (the ESP32 is not a browser, so it is not affected either way).
app.use(cors(process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN.split(',').map((s) => s.trim()) } : undefined));
app.use(express.json({ limit: '100kb' }));
app.use(trimBody);

// Health check — useful for confirming the deploy pipeline works,
// and as a target for your pre-demo warm-up ping.
app.get('/health', (req, res) => {
  res.json({ status: 'ok', auth: auth.authEnabled });
});

// Everything under /api needs a signed-in user, except sign-in itself and the routes the device
// calls with its own key (see DEVICE_ROUTES in auth.js). No-op until JWT_SECRET is set.
app.use('/api', auth.gate);

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/venues', venuesRouter);
app.use('/api/devices', devicesRouter);
app.use('/api/students', studentsRouter);
app.use('/api/access-events', accessEventsRouter);
app.use('/api/modules', modulesRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/stats', statsRouter);

// Unknown routes -> JSON 404; unexpected errors (e.g. malformed JSON body) -> JSON, never an HTML stack trace
app.use((req, res) => res.status(404).json({ error: 'not found' }));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON body' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'request body too large' });
  console.error(err);
  res.status(500).json({ error: 'internal server error' });
});

// Prepare the database (Neon may take a few seconds to wake up), then start listening.
async function start() {
  for (let attempt = 1; ; attempt++) {
    try {
      await ensureSchema();
      await auth.seedAdmin();
      break;
    } catch (err) {
      if (attempt >= 5) { console.error('Could not prepare the database:', err); process.exit(1); }
      console.warn(`Database not ready (attempt ${attempt}/5): ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  const PORT = process.env.PORT || 3000;
  const server = app.listen(PORT, (err) => {
    if (err) { console.error(`Could not listen on port ${PORT}:`, err.message); process.exit(1); }
    console.log(`Backend listening on port ${PORT}`);
  });
  server.on('error', (err) => { console.error('Server error:', err.message); process.exit(1); });
}

start();
