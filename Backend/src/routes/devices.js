const express = require('express');
const router = express.Router();
const pool = require('../db');
const crypto = require('crypto');
const { validateIdParam, isId, handleDbError, LIVE_STATUS } = require('../http');
const { requireDevice } = require('../deviceAuth');
const auth = require('../auth');
const { SLOTS, isValidDate } = require('../bookings');

const BATCH_MAX = 100; // keep in step with routes/accessEvents.js

router.param('id', validateIdParam);



// POST /api/devices — register a device against a venue
router.post('/', auth.requireAdmin, async (req, res) => {
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
    const device = result.rows[0];
    if (!auth.isAdmin(req)) delete device.api_key; // the device key is a secret: administrators only
    res.json(device);
  } catch (err) {
    handleDbError(res, err);
  }
});

// PUT /api/devices/:id — edit name/venue assignment
router.put('/:id', auth.requireAdmin, async (req, res) => {
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
router.delete('/:id', auth.requireAdmin, async (req, res) => {
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

// The exam session a device should serve right now. Before 12:00 local time it is the 09:00 slot,
// from 12:00 onwards the 13:00 slot (EXAM_TIMEZONE, default Africa/Johannesburg).
function currentSession() {
  const tz = process.env.EXAM_TIMEZONE || 'Africa/Johannesburg';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, slot: Number(parts.hour) < 12 ? SLOTS[0] : SLOTS[1] };
}

// GET /api/devices/:id/session[?date=YYYY-MM-DD&slot=09:00] — who may enter this venue in this session.
// Only students with a reserved seat are listed; the device denies everyone else.
// `onThisDevice` is true when the student's face is enrolled on THIS device.
router.get('/:id/session', requireDevice, async (req, res) => {
  const now = currentSession();
  const date = req.query.date ?? now.date;
  const slot = req.query.slot ?? now.slot;
  if (!isValidDate(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  if (!SLOTS.includes(slot)) return res.status(400).json({ error: `slot must be one of ${SLOTS.join(', ')}` });
  try {
    const { rows } = await pool.query(
      `SELECT s.id AS "studentId", s.student_number AS "studentNumber", s.name, r.seat_number AS "seatNumber",
              m.code AS "moduleCode", (s.device_id = $1 AND s.enrollment_status = 'enrolled') AS "onThisDevice"
       FROM seat_reservations r
       JOIN students s ON s.id = r.student_id
       JOIN exam_bookings b ON b.id = r.booking_id
       JOIN modules m ON m.id = b.module_id
       WHERE r.venue_id = $2 AND r.exam_date = $3 AND r.slot = $4
       ORDER BY r.seat_number`,
      [req.device.id, req.device.venue_id, date, slot]
    );
    res.json({ venueId: req.device.venue_id, date, slot, serverTime: new Date().toISOString(), students: rows });
  } catch (err) {
    handleDbError(res, err);
  }
});

module.exports = router;