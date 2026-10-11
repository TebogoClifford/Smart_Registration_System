const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { trimBody } = require('./http');
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});