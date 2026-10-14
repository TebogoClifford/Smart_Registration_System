const express = require('express');
const router = express.Router();
const pool = require('../db');
const { validateIdParam, isId, handleDbError, keyMatches } = require('../http');

router.param('id', validateIdParam);

// POST /api/access-events — device reports an access decision
router.post('/', async (req, res) => {
  const { deviceId, studentId, decision, timestamp } = (req.body ?? {});

  if (!deviceId || !decision) {
    return res.status(400).json({ error: 'deviceId and decision are required' });
  }
  // 'error' = device could not capture/match (design: Access Verification "Error" status)
  if (!['granted', 'denied', 'error'].includes(decision)) {
    return res.status(400).json({ error: "decision must be 'granted', 'denied' or 'error'" });
  }
  if (!isId(deviceId)) return res.status(400).json({ error: 'deviceId must be a positive integer' });
  if (studentId && !isId(studentId)) return res.status(400).json({ error: 'studentId must be a positive integer' });
  if (timestamp && Number.isNaN(Date.parse(timestamp))) {
    return res.status(400).json({ error: 'timestamp must be a valid date/time' });
  }

  try {
    const deviceCheck = await pool.query('SELECT id, api_key FROM devices WHERE id = $1', [deviceId]);
    if (deviceCheck.rows.length === 0) {
      return res.status(404).json({ error: 'device not found' });
    }
    // Only the registered device may report events (design: shared secret on each request)
    if (!keyMatches(req.get('X-Device-Key'), deviceCheck.rows[0].api_key)) {
      return res.status(401).json({ error: 'invalid or missing device key' });
    }

    const result = await pool.query(
      `INSERT INTO access_events (device_id, student_id, decision, event_time)
       VALUES ($1, $2, $3, COALESCE($4, NOW()))
       RETURNING id, device_id AS "deviceId", student_id AS "studentId", decision, event_time AS "timestamp"`,
      [deviceId, studentId || null, decision, timestamp || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    handleDbError(res, err);
  }
});

// GET /api/access-events — feed for the live dashboard (polling).
// Optional ?from=&to= (ISO timestamps, from inclusive / to exclusive) and ?limit= (default 100, max 500).
router.get('/', async (req, res) => {
  const { from, to } = req.query;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
  for (const [k, v] of [['from', from], ['to', to]]) {
    if (v && Number.isNaN(Date.parse(v))) {
      return res.status(400).json({ error: `${k} must be a valid date/time` });
    }
  }
  try {
    const result = await pool.query(
      `SELECT e.id, e.device_id AS "deviceId", e.student_id AS "studentId", e.decision,
              e.event_time AS "timestamp",
              EXISTS (SELECT 1 FROM event_overrides o WHERE o.event_id = e.id) AS overridden
       FROM access_events e
       WHERE ($1::timestamptz IS NULL OR e.event_time >= $1)
         AND ($2::timestamptz IS NULL OR e.event_time <  $2)
       ORDER BY e.event_time DESC, e.id DESC
       LIMIT $3`,
      [from || null, to || null, limit]
    );
    res.json(result.rows);
  } catch (err) {
    handleDbError(res, err);
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
    handleDbError(res, err);
  }
});

module.exports = router;