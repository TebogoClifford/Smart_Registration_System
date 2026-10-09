const express = require('express');
const router = express.Router();
const pool = require('../db');

// POST /api/access-events — device reports an access decision
router.post('/', async (req, res) => {
  const { deviceId, studentId, decision, timestamp } = (req.body ?? {});

  if (!deviceId || !decision) {
    return res.status(400).json({ error: 'deviceId and decision are required' });
  }
  if (!['granted', 'denied'].includes(decision)) {
    return res.status(400).json({ error: "decision must be 'granted' or 'denied'" });
  }

  try {
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

// POST /api/access-events/:id/override — manual override by invigilator
router.post('/:id/override', async (req, res) => {
  const { id } = req.params;
  const { invigilatorId, reason } = (req.body ?? {});

  if (!invigilatorId || !reason) {
    return res.status(400).json({ error: 'invigilatorId and reason are required' });
  }

  try {
    // 1. Verify event exists
    const eventCheck = await pool.query('SELECT id FROM access_events WHERE id = $1', [id]);
    if (eventCheck.rows.length === 0) {
      return res.status(404).json({ error: 'event not found' });
    }

    // 2. Log the override in the separate audit table
    await pool.query(
      `INSERT INTO event_overrides (event_id, invigilator_id, reason)
       VALUES ($1, $2, $3)`,
      [id, invigilatorId, reason]
    );

    res.json({ status: 'success', message: 'Entry override recorded' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  }
});

module.exports = router;