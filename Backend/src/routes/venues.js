const express = require('express');
const router = express.Router();
const prisma = require('../db');
const { validateIdParam, handleDbError, isNotFound, liveStatus } = require('../http');
const auth = require('../auth');

// capacity: whole number of seats, 1..10000
const parseCapacity = (v) => (Number.isInteger(v) && v >= 1 && v <= 10000 ? v : null);

router.param('id', validateIdParam);

// POST /api/venues — create a venue
router.post('/', auth.requireAdmin, async (req, res) => {
  const { name } = (req.body ?? {});
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  const capacity = parseCapacity(req.body.capacity);
  if (capacity === null) return res.status(400).json({ error: 'capacity must be a whole number of seats between 1 and 10000' });
  try {
    res.status(201).json(await prisma.venues.create({ data: { name: String(name), capacity } }));
  } catch (err) {
    handleDbError(res, err);
  }
});

// GET /api/venues — list all venues
router.get('/', async (req, res) => {
  try {
    res.json(await prisma.venues.findMany({ orderBy: { id: 'asc' } }));
  } catch (err) {
    handleDbError(res, err);
  }
});

// GET /api/venues/:id — single venue
router.get('/:id', async (req, res) => {
  try {
    const venue = await prisma.venues.findUnique({ where: { id: Number(req.params.id) } });
    if (!venue) return res.status(404).json({ error: 'venue not found' });
    res.json(venue);
  } catch (err) {
    handleDbError(res, err);
  }
});

// GET /api/venues/:id/devices — devices assigned to a venue (api_key omitted)
router.get('/:id/devices', async (req, res) => {
  const id = Number(req.params.id);
  try {
    if (!(await prisma.venues.findUnique({ where: { id }, select: { id: true } }))) return res.status(404).json({ error: 'venue not found' });
    const devices = await prisma.devices.findMany({
      where: { venue_id: id }, select: { id: true, venue_id: true, name: true, last_seen: true }, orderBy: { id: 'asc' },
    });
    res.json(devices.map((d) => ({ ...d, status: liveStatus(d.last_seen) })));
  } catch (err) {
    handleDbError(res, err);
  }
});

// PUT /api/venues/:id — edit a venue's name and capacity
router.put('/:id', auth.requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { name } = (req.body ?? {});
  if (!name) return res.status(400).json({ error: 'name is required' });
  const capacity = parseCapacity(req.body.capacity);
  if (capacity === null) return res.status(400).json({ error: 'capacity must be a whole number of seats between 1 and 10000' });
  try {
    // never shrink a hall below seats already reserved in any one session
    const sessions = await prisma.seat_reservations.groupBy({ by: ['exam_date', 'slot'], where: { venue_id: id }, _count: { _all: true } });
    const most = Math.max(0, ...sessions.map((s) => s._count._all));
    if (capacity < most) {
      return res.status(409).json({ error: `Cannot reduce capacity to ${capacity}: ${most} seats are already reserved in one session. Cancel or move a booking first.` });
    }
    res.json(await prisma.venues.update({ where: { id }, data: { name: String(name), capacity } }));
  } catch (err) {
    if (isNotFound(err)) return res.status(404).json({ error: 'venue not found' });
    handleDbError(res, err);
  }
});

// DELETE /api/venues/:id — blocked if devices reference this venue
router.delete('/:id', auth.requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const devices = await prisma.devices.count({ where: { venue_id: id } });
    if (devices > 0) {
      return res.status(409).json({
        error: `Cannot delete venue: ${devices} device(s) still assigned. Remove them first.`,
      });
    }
    const booked = await prisma.exam_bookings.count({ where: { venue_id: id } });
    if (booked > 0) return res.status(409).json({ error: `Cannot delete venue: ${booked} exam booking(s) use it. Cancel them first.` });
    const { count } = await prisma.venues.deleteMany({ where: { id } });
    if (count === 0) return res.status(404).json({ error: 'venue not found' });
    res.status(204).send();
  } catch (err) {
    handleDbError(res, err);
  }
});

module.exports = router;
