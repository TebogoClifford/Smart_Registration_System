const express = require('express');
const router = express.Router();
const prisma = require('../db');
const { validateIdParam, isId, handleDbError, pgCode, toDbDate } = require('../http');
const { requireDevice } = require('../deviceAuth');
const { sessionAt } = require('../bookings');
const { wasLetIn } = require('../inside');

router.param('id', validateIdParam);

// 'error' = device could not capture/match; 'already' = recognised again after being let in this session
const DECISIONS = ['granted', 'denied', 'error', 'already'];
const BATCH_MAX = 100;                            // keep in step with routes/devices.js (config)
const MAX_AGE_SECONDS = 30 * 24 * 3600;           // events older than 30 days are rejected
const MAX_FUTURE_SECONDS = 5 * 60;                // clock skew allowance

// Check one event's fields. Returns { error } or { value } (cleaned values ready for SQL).
function checkEvent(e) {
  if (!e || typeof e !== 'object') return { error: 'event must be an object' };
  if (!DECISIONS.includes(e.decision)) return { error: "decision must be 'granted', 'denied', 'error' or 'already'" };
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

// The event fields the API returns.
const EVENT_SELECT = { id: true, device_id: true, student_id: true, decision: true, event_time: true, client_event_id: true };
const toApi = (e) => ({ id: e.id, deviceId: e.device_id, studentId: e.student_id, decision: e.decision, timestamp: e.event_time, clientEventId: e.client_event_id });

// Insert one event for a device. Returns { id, ..., duplicate } — a repeated clientEventId
// from the same device returns the original event instead of creating a second row.
async function insertEvent(deviceId, v) {
  const when = v.timestamp ? new Date(v.timestamp) : new Date(Date.now() - (v.secondsAgo ?? 0) * 1000);
  // a student is let in once per exam session; seen again, they are recorded as already inside
  const decision = v.decision === 'granted' && v.studentId && (await wasLetIn(prisma, v.studentId, when)) ? 'already' : v.decision;
  try {
    const e = await prisma.access_events.create({
      data: { device_id: deviceId, student_id: v.studentId, decision, event_time: when, client_event_id: v.clientEventId },
      select: EVENT_SELECT,
    });
    return { ...toApi(e), duplicate: false };
  } catch (err) {
    // the unique index on (device_id, client_event_id) says this upload was already stored
    if (pgCode(err) !== '23505' || !v.clientEventId) throw err;
    const e = await prisma.access_events.findFirst({ where: { device_id: deviceId, client_event_id: v.clientEventId }, select: EVENT_SELECT });
    return { ...toApi(e), duplicate: true };
  }
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
      if (pgCode(err) === '23503') {
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
    const events = await prisma.access_events.findMany({
      where: { event_time: { ...(from && { gte: new Date(from) }), ...(to && { lt: new Date(to) }) } },
      select: { id: true, device_id: true, student_id: true, decision: true, event_time: true, _count: { select: { event_overrides: true } } },
      orderBy: [{ event_time: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    res.json(events.map((e) => ({
      id: e.id, deviceId: e.device_id, studentId: e.student_id, decision: e.decision, timestamp: e.event_time,
      overridden: e._count.event_overrides > 0,
    })));
  } catch (err) {
    handleDbError(res, err);
  }
});

// GET /api/access-events/recognitions?limit=8 — the latest recognised students, newest first, for the
// web console's "Recognised now" panel: who, at which device/hall, and their seat in the exam session
// running when they were recognised (null when they have none then). decision 'already' = seen again
// after being let in during that session.
router.get('/recognitions', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 8, 1), 50);
  try {
    const events = await prisma.access_events.findMany({
      where: { student_id: { not: null } },
      select: {
        id: true, decision: true, event_time: true,
        devices: { select: { id: true, name: true, venues: { select: { id: true, name: true } } } },
        students: { select: { id: true, student_number: true, name: true, course_name: true, enrollment_image_type: true } },
      },
      orderBy: [{ event_time: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    const out = [];
    for (const e of events) {
      const { date, slot } = sessionAt(e.event_time ?? new Date());
      const seat = await prisma.seat_reservations.findFirst({
        where: { student_id: e.students.id, exam_date: toDbDate(date), slot },
        select: { seat_number: true, venue_id: true, exam_bookings: { select: { modules: { select: { code: true, name: true } }, venues: { select: { name: true } } } } },
      });
      out.push({
        id: e.id, decision: e.decision, timestamp: e.event_time,
        device: { id: e.devices.id, name: e.devices.name }, venue: e.devices.venues,
        student: {
          id: e.students.id, studentNumber: e.students.student_number, name: e.students.name,
          course: e.students.course_name, hasPhoto: !!e.students.enrollment_image_type,
        },
        session: { date, slot },
        seat: seat && {
          number: seat.seat_number, moduleCode: seat.exam_bookings.modules.code, moduleName: seat.exam_bookings.modules.name,
          venueName: seat.exam_bookings.venues.name, inThisVenue: seat.venue_id === e.devices.venues.id,
        },
      });
    }
    res.json(out);
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
    if (!(await prisma.access_events.findUnique({ where: { id: Number(id) }, select: { id: true } }))) {
      return res.status(404).json({ error: 'event not found' });
    }
    await prisma.event_overrides.create({ data: { event_id: Number(id), invigilator_id: String(invigilatorId), reason: String(reason) } });
    res.json({ status: 'success', message: 'Entry override recorded' });
  } catch (err) {
    handleDbError(res, err);
  }
});

module.exports = router;
