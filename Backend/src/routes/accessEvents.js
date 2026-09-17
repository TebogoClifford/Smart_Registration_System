const express = require('express');
const router = express.Router();
const pool = require('../db');

// POST /api/access-events — device reports an access decision
router.post('/', async (req, res) => {
  const { deviceId, studentId, decision, timestamp } = req.body;

  if (!deviceId || !decision) {
    return res.status(400).json({ error: 'deviceId and decision are required' });
  }
  if (!['granted', 'denied'].includes(decision)) {
    return res.status(400).json({ error: "decision must be 'granted' or 'denied'" });
  }

  try {
    // Confirm the device exists before inserting (per design doc: "verify device exists")
    const deviceCheck = await pool.query('SELECT id FROM devices WHERE id = $1', [deviceId]);
    if (deviceCheck.rows.length === 0) {
      return res.status(404).json({ error: 'device not found' });
    }

    const result = await pool.query(
      `INSERT INTO access_events (device_id, student_id, decision, event_time)
       VALUES ($1, $2, $3, COALESCE($4, NOW()))
       RETURNING id, device_id AS "deviceId", student_id AS "studentId", decision, event_time AS "timestamp"`,
      [deviceId, studentId || null, decision, timestamp || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// GET /api/access-events — feed for the live dashboard (polling)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, device_id AS "deviceId", student_id AS "studentId", decision, event_time AS "timestamp"
       FROM access_events ORDER BY event_time DESC LIMIT 100`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  }
});

module.exports = router;