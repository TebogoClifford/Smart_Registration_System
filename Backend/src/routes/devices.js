const express = require('express');
const router = express.Router();
const pool = require('../db');
const crypto = require('crypto');
const { validateIdParam, isId, handleDbError, LIVE_STATUS } = require('../http');
const { requireDevice } = require('../deviceAuth');

const BATCH_MAX = 100; // keep in step with routes/accessEvents.js

router.param('id', validateIdParam);



// POST /api/devices — register a device against a venue
router.post('/', async (req, res) => {
  const { venue_id, name } = (req.body ?? {});
  if (!venue_id || !name) {
    return res.status(400).json({ error: 'venue_id and name are required' });
  }
  if (!isId(venue_id)) return res.status(400).json({ error: 'venue_id must be a positive integer' });
  const api_key = crypto.randomBytes(32).toString('hex');
  try {
    const result = await pool.query(
      `INSERT INTO devices (venue_id, name, api_key, status)
       VALUES ($1, $2, $3, 'inactive') RETURNING *`,
      [venue_id, name, api_key]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    handleDbError(res, err);
  }
});

// GET /api/devices — list all devices
router.get('/', async (req, res) => {
  try {
    // api_key is a secret — only the single-device view (admin copy-to-firmware) returns it
    const result = await pool.query(
      `SELECT id, venue_id, name, ${LIVE_STATUS} AS status, last_seen FROM devices ORDER BY id`
    );
    res.json(result.rows);
  } catch (err) {
    handleDbError(res, err);
  }
});

// GET /api/devices/:id — single device (needed for detail page)
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, venue_id, name, api_key, ${LIVE_STATUS} AS status, last_seen FROM devices WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'device not found' });
    res.json(result.rows[0]);
  } catch (err) {
    handleDbError(res, err);
  }
});

// PUT /api/devices/:id — edit name/venue assignment
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, venue_id } = (req.body ?? {});
  if (!name || !venue_id) return res.status(400).json({ error: 'name and venue_id are required' });
  if (!isId(venue_id)) return res.status(400).json({ error: 'venue_id must be a positive integer' });
  try {
    const result = await pool.query(
      'UPDATE devices SET name = $1, venue_id = $2 WHERE id = $3 RETURNING *',
      [name, venue_id, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'device not found' });
    res.json(result.rows[0]);
  } catch (err) {
    handleDbError(res, err);
  }
});

// DELETE /api/devices/:id — blocked if students are enrolled on this device
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const studentCheck = await pool.query('SELECT id FROM students WHERE device_id = $1', [id]);
    if (studentCheck.rows.length > 0) {
      return res.status(409).json({
        error: `Cannot delete device: ${studentCheck.rows.length} student(s) still enrolled. Remove them first.`,
      });
    }
    // Access events are the audit trail, so a device that has reported events cannot be deleted.
    const eventCheck = await pool.query('SELECT 1 FROM access_events WHERE device_id = $1 LIMIT 1', [id]);
    if (eventCheck.rows.length > 0) {
      return res.status(409).json({
        error: 'Cannot delete device: it has recorded access events (audit history). Set it inactive instead.',
      });
    }
    const result = await pool.query('DELETE FROM devices WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'device not found' });
    res.status(204).send();
  } catch (err) {
    handleDbError(res, err);
  }
});

// POST /api/devices/heartbeat — device reports it is alive (also refreshed by every other device call).
// Needs deviceId in the body and the device's key in the X-Device-Key header.
router.post('/heartbeat', requireDevice, (req, res) => {
  res.json({ status: 'ok', serverTime: new Date().toISOString() });
});

// ---------- device-facing endpoints (authenticated with X-Device-Key, see deviceAuth.js) ----------
const envInt = (name, fallback) => {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// GET /api/devices/:id/config — settings the device reads at boot, so they can be tuned
// from the server without re-flashing firmware.
router.get('/:id/config', requireDevice, (req, res) => {
  res.json({
    deviceId: req.device.id,
    name: req.device.name,
    venueId: req.device.venue_id,
    captureDistanceCm: envInt('DEVICE_CAPTURE_DISTANCE_CM', 30),
    heartbeatIntervalSeconds: envInt('DEVICE_HEARTBEAT_SECONDS', 30),
    enrollmentPollSeconds: envInt('DEVICE_ENROLL_POLL_SECONDS', 3),
    eventBatchMax: BATCH_MAX,
    serverTime: new Date().toISOString(),
  });
});

// GET /api/devices/:id/pending-enrollments — students an invigilator has asked this device to
// capture. The device polls this (the design is HTTP-only, so the server cannot push).
// Requests older than ENROLL_REQUEST_TTL_SECONDS (default 10 min) are ignored as abandoned.
router.get('/:id/pending-enrollments', requireDevice, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id AS "studentId", student_number AS "studentNumber", name
       FROM students
       WHERE device_id = $1 AND enrollment_status = 'pending'
         AND enrollment_requested_at > NOW() - make_interval(secs => $2)
       ORDER BY enrollment_requested_at, id`,
      [req.device.id, envInt('ENROLL_REQUEST_TTL_SECONDS', 600)]
    );
    res.json(rows);
  } catch (err) {
    handleDbError(res, err);
  }
});

// GET /api/devices/:id/roster — students currently enrolled on this device. Face data lives on the
// device, so it compares this list with its stored faces and deletes any that are no longer listed
// (for example after a student record was removed in the web app).
router.get('/:id/roster', requireDevice, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id AS "studentId", student_number AS "studentNumber", name
       FROM students WHERE device_id = $1 AND enrollment_status = 'enrolled' ORDER BY id`,
      [req.device.id]
    );
    res.json(rows);
  } catch (err) {
    handleDbError(res, err);
  }
});

module.exports = router;