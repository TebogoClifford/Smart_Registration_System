// /api/bookings — book an exam venue for a module; seats are reserved for every enrolled student.
const express = require('express');
const router = express.Router();
const prisma = require('../db');
const { validateIdParam, isId, handleDbError, toDbDate, fromDbDate } = require('../http');
const { SLOTS, isValidDate, sessionAt, HttpError, availability, assignSeats, failIfProblems, lockSession, inTransaction } = require('../bookings');

router.param('id', validateIdParam);

// GET /api/bookings/availability?venueId=1&date=2026-11-03&slot=09:00
// "62 of 100 seats free", plus what is already booked in that venue/date/slot.
router.get('/availability', async (req, res) => {
  const { venueId, date, slot } = req.query;
  if (!isId(venueId)) return res.status(400).json({ error: 'venueId must be a positive integer' });
  if (!isValidDate(date)) return res.status(400).json({ error: 'date must be a real date in YYYY-MM-DD format' });
  if (!SLOTS.includes(slot)) return res.status(400).json({ error: `slot must be one of ${SLOTS.join(', ')}` });
  try {
    const a = await availability(prisma, venueId, date, slot);
    if (!a) return res.status(404).json({ error: 'venue not found' });
    const rows = await prisma.exam_bookings.findMany({
      where: { venue_id: Number(venueId), exam_date: toDbDate(date), slot },
      select: { id: true, modules: { select: { code: true, name: true } }, _count: { select: { seat_reservations: true } } },
      orderBy: { modules: { code: 'asc' } },
    });
    res.json({ ...a, bookings: rows.map((b) => ({ id: b.id, code: b.modules.code, name: b.modules.name, seats: b._count.seat_reservations })) });
  } catch (err) { handleDbError(res, err); }
});

// GET /api/bookings/date-availability?moduleId=&venueId=&from=&to=[&excludeBookingId=]
// For a date picker: for every day in from..to (max 62 days) and both sessions, can this module sit
// in this hall then? A day/session is unavailable when it is in the past, the hall has too few free
// seats, some of the module's students already sit another exam then, or the module is already
// booked then. excludeBookingId = the booking being moved (its own seats and slot count as free).
router.get('/date-availability', async (req, res) => {
  const { moduleId, venueId, from, to, excludeBookingId } = req.query;
  if (!isId(moduleId) || !isId(venueId)) return res.status(400).json({ error: 'moduleId and venueId are required' });
  if (!isValidDate(from) || !isValidDate(to) || from > to) return res.status(400).json({ error: 'from and to must be YYYY-MM-DD, from not after to' });
  const days = Math.round((toDbDate(to) - toDbDate(from)) / 86400000) + 1;
  if (days > 62) return res.status(400).json({ error: 'at most 62 days at a time' });
  if (excludeBookingId !== undefined && !isId(excludeBookingId)) return res.status(400).json({ error: 'excludeBookingId must be a positive integer' });
  const mId = Number(moduleId), vId = Number(venueId), skip = excludeBookingId ? Number(excludeBookingId) : null;
  const range = { gte: toDbDate(from), lte: toDbDate(to) };
  try {
    const [venue, members, taken, ownBookings] = await Promise.all([
      prisma.venues.findUnique({ where: { id: vId }, select: { name: true, capacity: true } }),
      prisma.student_modules.findMany({ where: { module_id: mId }, select: { student_id: true } }),
      prisma.seat_reservations.groupBy({
        by: ['exam_date', 'slot'], where: { venue_id: vId, exam_date: range, ...(skip && { booking_id: { not: skip } }) }, _count: { _all: true },
      }),
      prisma.exam_bookings.findMany({ where: { module_id: mId, exam_date: range, ...(skip && { id: { not: skip } }) }, select: { exam_date: true, slot: true } }),
    ]);
    if (!venue) return res.status(404).json({ error: 'venue not found' });
    const studentIds = members.map((m) => m.student_id);
    // the module's students who already sit another exam, per day/session
    const clashRows = studentIds.length ? await prisma.seat_reservations.groupBy({
      by: ['exam_date', 'slot'],
      where: { student_id: { in: studentIds }, exam_date: range, ...(skip && { booking_id: { not: skip } }) },
      _count: { student_id: true },
    }) : [];
    const key = (d, s) => `${fromDbDate(d)}|${s}`;
    const used = new Map(taken.map((g) => [key(g.exam_date, g.slot), g._count._all]));
    const clashes = new Map(clashRows.map((g) => [key(g.exam_date, g.slot), g._count.student_id]));
    const booked = new Set(ownBookings.map((b) => key(b.exam_date, b.slot)));
    const today = sessionAt(new Date()).date;
    const needed = studentIds.length;

    const out = [];
    for (let i = 0; i < days; i++) {
      const date = fromDbDate(new Date(toDbDate(from).getTime() + i * 86400000));
      const slots = {};
      for (const slot of SLOTS) {
        const k = `${date}|${slot}`;
        const remaining = venue.capacity - (used.get(k) ?? 0);
        const reason = date < today ? 'In the past'
          : venue.capacity < 1 ? `${venue.name} has no seat count`
            : booked.has(k) ? 'This module is already booked then'
              : clashes.get(k) ? `${clashes.get(k)} student(s) already sit another exam then`
                : remaining < needed ? `Not enough seats: ${remaining} free, ${needed} needed`
                  : null;
        slots[slot] = { ok: !reason, remaining, reason };
      }
      out.push({ date, slots });
    }
    res.json({ venueName: venue.name, capacity: venue.capacity, needed, days: out });
  } catch (err) { handleDbError(res, err); }
});

// Bookings in the shape the web console uses, with seats in this booking and seats taken in its
// whole venue/date/slot (several modules can share a hall).
async function listBookings(where) {
  const rows = await prisma.exam_bookings.findMany({
    where,
    include: {
      modules: { select: { code: true, name: true } },
      venues: { select: { name: true, capacity: true } },
      _count: { select: { seat_reservations: true } },
    },
    orderBy: [{ exam_date: 'desc' }, { slot: 'asc' }, { modules: { code: 'asc' } }],
  });
  if (rows.length === 0) return [];
  const sessions = await prisma.seat_reservations.groupBy({
    by: ['venue_id', 'exam_date', 'slot'],
    where: { OR: rows.map((b) => ({ venue_id: b.venue_id, exam_date: b.exam_date, slot: b.slot })) },
    _count: { _all: true },
  });
  const key = (v, d, s) => `${v}|${fromDbDate(d)}|${s}`;
  const taken = new Map(sessions.map((g) => [key(g.venue_id, g.exam_date, g.slot), g._count._all]));
  return rows.map((b) => {
    const slotReserved = taken.get(key(b.venue_id, b.exam_date, b.slot)) ?? 0;
    return {
      id: b.id, module_id: b.module_id, module_code: b.modules.code, module_name: b.modules.name,
      venue_id: b.venue_id, venue_name: b.venues.name, venue_capacity: b.venues.capacity,
      exam_date: fromDbDate(b.exam_date), slot: b.slot, booked_by: b.booked_by, created_at: b.created_at,
      seats: b._count.seat_reservations, slot_reserved: slotReserved, remaining: b.venues.capacity - slotReserved,
    };
  });
}

// GET /api/bookings?date=&from=&to=&venueId=&moduleId=   (from/to: an inclusive date range, e.g. one calendar month)
router.get('/', async (req, res) => {
  const { date, from, to, venueId, moduleId } = req.query;
  const where = {};
  if (date !== undefined) { if (!isValidDate(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' }); where.exam_date = toDbDate(date); }
  if (from !== undefined || to !== undefined) {
    if (date !== undefined) return res.status(400).json({ error: 'use either date or from/to, not both' });
    if ((from !== undefined && !isValidDate(from)) || (to !== undefined && !isValidDate(to))) return res.status(400).json({ error: 'from and to must be YYYY-MM-DD' });
    if (from !== undefined && to !== undefined && from > to) return res.status(400).json({ error: 'from must not be after to' });
    where.exam_date = { ...(from !== undefined && { gte: toDbDate(from) }), ...(to !== undefined && { lte: toDbDate(to) }) };
  }
  if (venueId !== undefined) { if (!isId(venueId)) return res.status(400).json({ error: 'venueId must be a positive integer' }); where.venue_id = Number(venueId); }
  if (moduleId !== undefined) { if (!isId(moduleId)) return res.status(400).json({ error: 'moduleId must be a positive integer' }); where.module_id = Number(moduleId); }
  try {
    res.json(await listBookings(where));
  } catch (err) { handleDbError(res, err); }
});

// GET /api/bookings/:id — one booking with every reserved seat
router.get('/:id', async (req, res) => {
  try {
    const [booking] = await listBookings({ id: Number(req.params.id) });
    if (!booking) return res.status(404).json({ error: 'booking not found' });
    const seats = await prisma.seat_reservations.findMany({
      where: { booking_id: booking.id },
      select: {
        seat_number: true,
        students: { select: { id: true, student_number: true, name: true, enrollment_status: true, devices: { select: { venue_id: true } } } },
      },
      orderBy: { seat_number: 'asc' },
    });
    const seatList = seats.map(({ seat_number, students: s }) => ({
      seat_number, student_id: s.id, student_number: s.student_number, name: s.name, enrollment_status: s.enrollment_status,
      // as before in SQL: unknown (null) when the student has no device
      ready_at_venue: s.devices ? s.enrollment_status === 'enrolled' && s.devices.venue_id === booking.venue_id : (s.enrollment_status === 'enrolled' ? null : false),
    }));
    res.json({ ...booking, seatList });
  } catch (err) { handleDbError(res, err); }
});

// POST /api/bookings  { moduleId, venueId, date, slot }
router.post('/', async (req, res) => {
  const { moduleId, venueId, date, slot } = req.body ?? {};
  if (!isId(moduleId) || !isId(venueId)) return res.status(400).json({ error: 'moduleId and venueId are required' });
  if (!isValidDate(date)) return res.status(400).json({ error: 'date must be a real date in YYYY-MM-DD format' });
  if (!SLOTS.includes(slot)) return res.status(400).json({ error: `slot must be one of ${SLOTS.join(', ')}` });
  const mId = Number(moduleId), vId = Number(venueId);
  try {
    const out = await inTransaction(prisma, async (tx) => {
      const mod = await tx.modules.findUnique({ where: { id: mId }, select: { id: true, code: true } });
      if (!mod) throw new HttpError(404, 'module not found');
      const ven = await tx.venues.findUnique({ where: { id: vId }, select: { id: true, name: true, capacity: true } });
      if (!ven) throw new HttpError(404, 'venue not found');
      if (ven.capacity < 1) throw new HttpError(409, `${ven.name} has no capacity set. Edit the venue and enter its number of seats first.`);
      if ((await tx.student_modules.count({ where: { module_id: mId } })) === 0) {
        throw new HttpError(409, `${mod.code} has no enrolled students, so there is nobody to seat.`);
      }

      await lockSession(tx, vId, date, slot);
      const dup = await tx.exam_bookings.findFirst({ where: { module_id: mId, exam_date: toDbDate(date), slot }, select: { id: true } });
      if (dup) throw new HttpError(409, `${mod.code} is already booked for ${date} at ${slot}.`);

      const created = await tx.exam_bookings.create({
        data: { module_id: mId, venue_id: vId, exam_date: toDbDate(date), slot, booked_by: req.user?.email ?? null },
        select: { id: true, module_id: true, venue_id: true, slot: true },
      });
      const booking = { ...created, exam_date: date };
      failIfProblems(await assignSeats(tx, booking), ven.name);

      // Students whose face is not enrolled on a device at this venue will be refused at the door: tell the invigilator now.
      const seated = await tx.seat_reservations.findMany({
        where: { booking_id: booking.id },
        select: { students: { select: { student_number: true, name: true, enrollment_status: true, devices: { select: { venue_id: true } } } } },
        orderBy: { students: { student_number: 'asc' } },
      });
      const notReady = seated
        .map((r) => r.students)
        .filter((s) => !(s.enrollment_status === 'enrolled' && s.devices?.venue_id === vId))
        .map(({ student_number, name }) => ({ student_number, name }));
      return { booking, notReady };
    });
    const [row] = await listBookings({ id: out.booking.id });
    res.status(201).json({ ...row, notReadyAtVenue: out.notReady });
  } catch (err) { handleDbError(res, err); }
});

// PUT /api/bookings/:id  { venueId, date, slot } — move a booking to another hall, day or session.
// Every student of the module is seated again in the new place; if they do not fit, or a student
// already sits another exam then, nothing changes (409). Open to administrators and invigilators.
router.put('/:id', async (req, res) => {
  const { venueId, date, slot } = req.body ?? {};
  if (!isId(venueId)) return res.status(400).json({ error: 'venueId is required' });
  if (!isValidDate(date)) return res.status(400).json({ error: 'date must be a real date in YYYY-MM-DD format' });
  if (!SLOTS.includes(slot)) return res.status(400).json({ error: `slot must be one of ${SLOTS.join(', ')}` });
  const id = Number(req.params.id), vId = Number(venueId);
  try {
    await inTransaction(prisma, async (tx) => {
      const b = await tx.exam_bookings.findUnique({ where: { id }, select: { id: true, module_id: true, modules: { select: { code: true } } } });
      if (!b) throw new HttpError(404, 'booking not found');
      const ven = await tx.venues.findUnique({ where: { id: vId }, select: { id: true, name: true, capacity: true } });
      if (!ven) throw new HttpError(404, 'venue not found');
      if (ven.capacity < 1) throw new HttpError(409, `${ven.name} has no capacity set. Edit the venue and enter its number of seats first.`);
      await lockSession(tx, vId, date, slot);
      const dup = await tx.exam_bookings.findFirst({ where: { module_id: b.module_id, exam_date: toDbDate(date), slot, id: { not: id } }, select: { id: true } });
      if (dup) throw new HttpError(409, `${b.modules.code} is already booked for ${date} at ${slot}.`);
      // free the old seats, move the booking, seat everyone again (all or nothing)
      await tx.seat_reservations.deleteMany({ where: { booking_id: id } });
      await tx.exam_bookings.update({ where: { id }, data: { venue_id: vId, exam_date: toDbDate(date), slot } });
      failIfProblems(await assignSeats(tx, { id, module_id: b.module_id, venue_id: vId, exam_date: date, slot }), ven.name);
    });
    const [row] = await listBookings({ id });
    res.json(row);
  } catch (err) { handleDbError(res, err); }
});

// DELETE /api/bookings/:id — cancel; the seats are freed
router.delete('/:id', async (req, res) => {
  try {
    const { count } = await prisma.exam_bookings.deleteMany({ where: { id: Number(req.params.id) } });
    if (count === 0) return res.status(404).json({ error: 'booking not found' });
    res.status(204).send();
  } catch (err) { handleDbError(res, err); }
});

module.exports = router;
