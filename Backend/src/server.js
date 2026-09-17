const express = require('express');
const cors = require('cors');
require('dotenv').config();

const venuesRouter = require('./routes/venues');
const devicesRouter = require('./routes/devices');
const studentsRouter = require('./routes/students');
const accessEventsRouter = require('./routes/accessEvents');

const app = express();
app.use(cors());
app.use(express.json());

// Health check — useful for confirming the deploy pipeline works,
// and as a target for your pre-demo warm-up ping.
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/venues', venuesRouter);
app.use('/api/devices', devicesRouter);
app.use('/api/students', studentsRouter);
app.use('/api/access-events', accessEventsRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});