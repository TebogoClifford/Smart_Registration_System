const express = require('express');
const router = express.Router();
const pool = require('../db');
const { validateIdParam, isId, handleDbError } = require('../http');
const { requireDevice } = require('../deviceAuth');

router.param('id', validateIdParam);

const DECISIONS = ['granted', 'denied', 'error']; // 'error' = device could not capture/match
const BATCH_MAX = 100;                            // keep in step with routes/devices.js (config)
const MAX_AGE_SECONDS = 30 * 24 * 3600;           // events older than 30 days are rejected
const MAX_FUTURE_SECONDS = 5 * 60;                // clock skew allowance

// Check one event's fields. Returns { error } or { value } (cleaned values ready for SQL).
function checkEvent(e) {
  if (!e || typeof e !== 'object') return { error: 'event must be an object' };
  if (!DECISIONS.includes(e.decision)) return { error: "decision must be 'granted', 'denied' or 'error'" };
  if (e.studentId !== undefined && e.studentId !== null && e.studentId !== '' && !isId(e.studentId)) {
    return { error: 'studentId must be a positive integer' };
  }
  let clientEventId = null;
  if (e.clientEventId !== undefined && e.clientEventId !== null) {
    clientEventId = String(e.clientEventId).trim();
    if (!clientEventId || clientEventId.length > 64) return { error: 'clientEventId must be 1-64 characters' };
  }
  // When the event happened: an ISO timestamp, OR secondsAgo (for a device with no real clock,
  // e.g. before NTP time sync), OR neither (server time = now).
  let timestamp = null;
  let secondsAgo = null;
  if (e.timestamp) {
    const t = Date.parse(e.timestamp);
    if (Number.isNaN(t)) return { error: 'timestamp must be a valid date/time' };
    const ageSeconds = (Date.now() - t) / 1000;
    if (ageSeconds > MAX_AGE_SECONDS || ageSeconds < -MAX_FUTURE_SECONDS) {
      return { error: 'timestamp is implausible (device clock not set?); send secondsAgo instead' };
    }
    timestamp = new Date(t).toISOString();
  } else if (e.secondsAgo !== undefined && e.secondsAgo !== null) {
    const s = Number(e.secondsAgo);
    if (!Number.isFinite(s) || s < 0 || s > MAX_AGE_SECONDS) return { error: 'secondsAgo must be between 0 and 2592000' };
    secondsAgo = s;
  }
  const studentId = e.studentId === undefined || e.studentId === null || e.studentId === '' ? null : Number(e.studentId);
  return { value: { decision: e.decision, studentId, clientEventId, timestamp, secondsAgo } };
}

// Insert one event for a device. Returns { id, ..., duplicate } — a repeated clientEventId
// from the same device returns the original event instead of creating a second row.
async function insertEvent(deviceId, v) {
  const sql = `
    INSERT INTO access_events (device_id, student_id, decision, event_time, client_event_id)
    VALUES ($1, $2, $3,
            COALESCE($4::timestamptz, NOW() - make_interval(secs => COALESCE($5::float8, 0))),
            $6)
    ON CONFLICT (device_id, client_event_id) WHERE client_event_id IS NOT NULL DO NOTHING
    RETURNING id, device_id AS "deviceId", student_id AS "studentId", decision, event_time AS "timestamp",
              client_event_id AS "clientEventId"`;
  const inserted = await pool.query(sql, [deviceId, v.studentId, v.decision, v.timestamp, v.secondsAgo, v.clientEventId]);
  if (inserted.rows.length > 0) return { ...inserted.rows[0], duplicate: false };
  const existing = await pool.query(
    `SELECT id, device_id AS "deviceId", student_id AS "studentId", decision, event_time AS "timestamp",
            client_event_id AS "clientEventId"
     FROM access_events WHERE device_id = $1 AND client_event_id = $2`,
    [deviceId, v.clientEventId]
  );
  return { ...existing.rows[0], duplicate: true };
}

// POST /api/access-events — device reports one access decision.
// Body: { deviceId, decision, studentId?, clientEventId?, timestamp? | secondsAgo? }  + X-Device-Key header.
// 201 = created, 200 = duplicate of an earlier upload (safe to treat as success).
router.post('/', requireDevice, async (req, res) => {
  const checked = checkEvent(req.body);
  if (checked.error) return res.status(400).json({ error: checked.error });
  try {
    const event = await insertEvent(req.device.id, checked.value);
    res.status(event.duplicate ? 200 : 201).json(event);
  } catch (err) {
    handleDbError(res, err);
  }
});

// POST /api/access-events/batch — upload events queued while the device was offline.
// Body: { deviceId, events: [ { clientEventId (required), decision, studentId?, timestamp? | secondsAgo? }, ... ] }
// Always answers 200 with one result per event, in order, so one bad event never blocks the rest:
//   { index, clientEventId, status: 'created' | 'duplicate' | 'rejected', id?, error? }
// The device should delete each queued event whose status is 'created' or 'duplicate', and
// drop or log 'rejected' ones (they will never succeed unchanged).
router.post('/batch', requireDevice, async (req, res) => {
  const events = req.body?.events;
  if (!Array.isArray(events) || events.length === 0) return res.status(400).json({ error: 'events must be a non-empty array' });
  if (events.length > BATCH_MAX) return res.status(400).json({ error: `at most ${BATCH_MAX} events per request` });

  const results = [];
  for (let index = 0; index < events.length; index++) {
    const e = events[index];
    const clientEventId = e && e.clientEventId !== undefined ? String(e.clientEventId) : undefined;
    if (!e || e.clientEventId === undefined || e.clientEventId === null || e.clientEventId === '') {
      results.push({ index, clientEventId, status: 'rejected', error: 'clientEventId is required in a batch' });
      continue;
    }
    const checked = checkEvent(e);
    if (checked.error) {
      results.push({ index, clientEventId, status: 'rejected', error: checked.error });
      continue;
    }
    try {
      const saved = await insertEvent(req.device.id, checked.value);
      results.push({ index, clientEventId, status: saved.duplicate ? 'duplicate' : 'created', id: saved.id });
    } catch (err) {
      // 23503 = student does not exist (anything else is a real server problem)
      if (err.code === '23503') {
        results.push({ index, clientEventId, status: 'rejected', error: 'studentId does not exist' });
      } else {
        console.error(err);
        return res.status(500).json({ error: 'internal server error', results });
      }
    }
  }
  res.json({ results });
});

// GET /api/access-events — feed for the dashboard.
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

// POST /api/access-events/:id/override — manual override by an invigilator.
// When sign-in is on, the invigilator is the signed-in user (cannot be faked from the browser).
router.post('/:id/override', async (req, res) => {
  const { id } = req.params;
  const invigilatorId = req.user ? req.user.email : req.body?.invigilatorId;
  const reason = req.body?.reason;

  if (!invigilatorId || !reason) {
    return res.status(400).json({ error: 'invigilatorId and reason are required' });
  }

  try {
    const eventCheck = await pool.query('SELECT id FROM access_events WHERE id = $1', [id]);
    if (eventCheck.rows.length === 0) {
      return res.status(404).json({ error: 'event not found' });
    }
    await pool.query(
      `INSERT INTO event_overrides (event_id, invigilator_id, reason) VALUES ($1, $2, $3)`,
      [id, invigilatorId, reason]
    );
    res.json({ status: 'success', message: 'Entry override recorded' });
  } catch (err) {
    handleDbError(res, err);
  }
});

module.exports = router;
