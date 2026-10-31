const express = require('express');
const router = express.Router();
const prisma = require('../db');
const crypto = require('crypto');
const { validateIdParam, isId, handleDbError, isNotFound, liveStatus, toDbDate } = require('../http');
const { requireDevice } = require('../deviceAuth');
const auth = require('../auth');
const { SLOTS, isValidDate, sessionAt } = require('../bookings');
const { insideIds } = require('../inside');

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
    const device = await prisma.devices.create({ data: { venue_id: Number(venue_id), name: String(name), api_key, status: 'inactive' } });
    res.status(201).json(device);
  } catch (err) {
    handleDbError(res, err);
  }
});

// GET /api/devices — list all devices
router.get('/', async (req, res) => {
  try {
    // api_key is a secret — only the single-device view (admin copy-to-firmware) returns it
    const devices = await prisma.devices.findMany({ select: { id: true, venue_id: true, name: true, last_seen: true }, orderBy: { id: 'asc' } });
    res.json(devices.map((d) => ({ ...d, status: liveStatus(d.last_seen) })));
  } catch (err) {
    handleDbError(res, err);
  }
});

// GET /api/devices/:id — single device (needed for detail page)
router.get('/:id', async (req, res) => {
  try {
    const row = await prisma.devices.findUnique({
      where: { id: Number(req.params.id) }, select: { id: true, venue_id: true, name: true, api_key: true, last_seen: true },
    });
    if (!row) return res.status(404).json({ error: 'device not found' });
    const device = { ...row, status: liveStatus(row.last_seen) };
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
    res.json(await prisma.devices.update({ where: { id: Number(id) }, data: { name: String(name), venue_id: Number(venue_id) } }));
  } catch (err) {
    if (isNotFound(err)) return res.status(404).json({ error: 'device not found' });
    handleDbError(res, err);
  }
});

// DELETE /api/devices/:id — blocked if students are enrolled on this device
router.delete('/:id', auth.requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const students = await prisma.students.count({ where: { device_id: Number(id) } });
    if (students > 0) {
      return res.status(409).json({
        error: `Cannot delete device: ${students} student(s) still enrolled. Remove them first.`,
      });
    }
    // Access events are the audit trail, so a device that has reported events cannot be deleted.
    if (await prisma.access_events.findFirst({ where: { device_id: Number(id) }, select: { id: true } })) {
      return res.status(409).json({
        error: 'Cannot delete device: it has recorded access events (audit history). Set it inactive instead.',
      });
    }
    const { count } = await prisma.devices.deleteMany({ where: { id: Number(id) } });
    if (count === 0) return res.status(404).json({ error: 'device not found' });
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
// A student as the device API names it.
const toDeviceStudent = (s) => ({ studentId: s.id, studentNumber: s.student_number, name: s.name });

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
    const since = new Date(Date.now() - envInt('ENROLL_REQUEST_TTL_SECONDS', 600) * 1000);
    const rows = await prisma.students.findMany({
      where: { device_id: req.device.id, enrollment_status: 'pending', enrollment_requested_at: { gt: since } },
      select: { id: true, student_number: true, name: true },
      orderBy: [{ enrollment_requested_at: 'asc' }, { id: 'asc' }],
    });
    res.json(rows.map(toDeviceStudent));
  } catch (err) {
    handleDbError(res, err);
  }
});

// GET /api/devices/:id/roster — students currently enrolled on this device. Face data lives on the
// device, so it compares this list with its stored faces and deletes any that are no longer listed
// (for example after a student record was removed in the web app).
router.get('/:id/roster', requireDevice, async (req, res) => {
  try {
    const rows = await prisma.students.findMany({
      where: { device_id: req.device.id, enrollment_status: 'enrolled' },
      select: { id: true, student_number: true, name: true },
      orderBy: { id: 'asc' },
    });
    res.json(rows.map(toDeviceStudent));
  } catch (err) {
    handleDbError(res, err);
  }
});

const currentSession = () => sessionAt(new Date());

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
    const seats = await prisma.seat_reservations.findMany({
      where: { venue_id: req.device.venue_id, exam_date: toDbDate(date), slot },
      select: {
        seat_number: true,
        students: { select: { id: true, student_number: true, name: true, device_id: true, enrollment_status: true } },
        exam_bookings: { select: { modules: { select: { code: true } } } },
      },
      orderBy: { seat_number: 'asc' },
    });
    const students = seats.map(({ seat_number, students: s, exam_bookings: b }) => ({
      ...toDeviceStudent(s), seatNumber: seat_number, moduleCode: b.modules.code,
      onThisDevice: s.device_id === req.device.id && s.enrollment_status === 'enrolled',
    }));
    // students already let in during this session (at any door), so a restarted device still says "already inside"
    const alreadyInside = await insideIds(prisma, { date, slot });
    res.json({ venueId: req.device.venue_id, date, slot, serverTime: new Date().toISOString(), students, alreadyInside });
  } catch (err) {
    handleDbError(res, err);
  }
});

module.exports = router;