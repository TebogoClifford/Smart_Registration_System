// /api/bookings — book an exam venue for a module; seats are reserved for every enrolled student.
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { validateIdParam, isId, handleDbError } = require('../http');
const { SLOTS, isValidDate, HttpError, availability, assignSeats, failIfProblems, lockSession, inTransaction } = require('../bookings');

router.param('id', validateIdParam);

// GET /api/bookings/availability?venueId=1&date=2026-11-03&slot=09:00
// "62 of 100 seats free", plus what is already booked in that venue/date/slot.
router.get('/availability', async (req, res) => {
  const { venueId, date, slot } = req.query;
  if (!isId(venueId)) return res.status(400).json({ error: 'venueId must be a positive integer' });
  if (!isValidDate(date)) return res.status(400).json({ error: 'date must be a real date in YYYY-MM-DD format' });
  if (!SLOTS.includes(slot)) return res.status(400).json({ error: `slot must be one of ${SLOTS.join(', ')}` });
  try {
    const a = await availability(pool, venueId, date, slot);
    if (!a) return res.status(404).json({ error: 'venue not found' });
    const { rows } = await pool.query(
      `SELECT b.id, m.code, m.name,
              (SELECT COUNT(*)::int FROM seat_reservations r WHERE r.booking_id = b.id) AS seats
       FROM exam_bookings b JOIN modules m ON m.id = b.module_id
       WHERE b.venue_id = $1 AND b.exam_date = $2 AND b.slot = $3 ORDER BY m.code`,
      [venueId, date, slot]
    );
    res.json({ ...a, bookings: rows });
  } catch (err) { handleDbError(res, err); }
});

const LIST_SQL = `
  SELECT b.id, b.module_id, m.code AS module_code, m.name AS module_name,
         b.venue_id, v.name AS venue_name, v.capacity AS venue_capacity,
         to_char(b.exam_date, 'YYYY-MM-DD') AS exam_date, b.slot, b.booked_by, b.created_at,
         (SELECT COUNT(*)::int FROM seat_reservations r WHERE r.booking_id = b.id) AS seats,
         (SELECT COUNT(*)::int FROM seat_reservations r WHERE r.venue_id = b.venue_id AND r.exam_date = b.exam_date AND r.slot = b.slot) AS slot_reserved
  FROM exam_bookings b JOIN modules m ON m.id = b.module_id JOIN venues v ON v.id = b.venue_id`;

// GET /api/bookings?date=&venueId=&moduleId=
router.get('/', async (req, res) => {
  const where = [], params = [];
  const { date, venueId, moduleId } = req.query;
  if (date !== undefined) { if (!isValidDate(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' }); params.push(date); where.push(`b.exam_date = $${params.length}`); }
  if (venueId !== undefined) { if (!isId(venueId)) return res.status(400).json({ error: 'venueId must be a positive integer' }); params.push(venueId); where.push(`b.venue_id = $${params.length}`); }
  if (moduleId !== undefined) { if (!isId(moduleId)) return res.status(400).json({ error: 'moduleId must be a positive integer' }); params.push(moduleId); where.push(`b.module_id = $${params.length}`); }
  try {
    const { rows } = await pool.query(`${LIST_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY b.exam_date DESC, b.slot, m.code`, params);
    res.json(rows.map((r) => ({ ...r, remaining: r.venue_capacity - r.slot_reserved })));
  } catch (err) { handleDbError(res, err); }
});

// GET /api/bookings/:id — one booking with every reserved seat
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`${LIST_SQL} WHERE b.id = $1`, [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'booking not found' });
    const seats = await pool.query(
      `SELECT r.seat_number, s.id AS student_id, s.student_number, s.name, s.enrollment_status,
              (s.enrollment_status = 'enrolled' AND d.venue_id = $2) AS ready_at_venue
       FROM seat_reservations r JOIN students s ON s.id = r.student_id LEFT JOIN devices d ON d.id = s.device_id
       WHERE r.booking_id = $1 ORDER BY r.seat_number`,
      [req.params.id, rows[0].venue_id]
    );
    res.json({ ...rows[0], remaining: rows[0].venue_capacity - rows[0].slot_reserved, seatList: seats.rows });
  } catch (err) { handleDbError(res, err); }
});

// POST /api/bookings  { moduleId, venueId, date, slot }
router.post('/', async (req, res) => {
  const { moduleId, venueId, date, slot } = req.body ?? {};
  if (!isId(moduleId) || !isId(venueId)) return res.status(400).json({ error: 'moduleId and venueId are required' });
  if (!isValidDate(date)) return res.status(400).json({ error: 'date must be a real date in YYYY-MM-DD format' });
  if (!SLOTS.includes(slot)) return res.status(400).json({ error: `slot must be one of ${SLOTS.join(', ')}` });
  try {
    const out = await inTransaction(pool, async (client) => {
      const mod = await client.query('SELECT id, code FROM modules WHERE id = $1', [moduleId]);
      if (mod.rows.length === 0) throw new HttpError(404, 'module not found');
      const ven = await client.query('SELECT id, name, capacity FROM venues WHERE id = $1', [venueId]);
      if (ven.rows.length === 0) throw new HttpError(404, 'venue not found');
      if (ven.rows[0].capacity < 1) throw new HttpError(409, `${ven.rows[0].name} has no capacity set. Edit the venue and enter its number of seats first.`);
      const n = await client.query('SELECT COUNT(*)::int AS n FROM student_modules WHERE module_id = $1', [moduleId]);
      if (n.rows[0].n === 0) throw new HttpError(409, `${mod.rows[0].code} has no enrolled students, so there is nobody to seat.`);

      await lockSession(client, venueId, date, slot);
      const dup = await client.query('SELECT 1 FROM exam_bookings WHERE module_id = $1 AND exam_date = $2 AND slot = $3', [moduleId, date, slot]);
      if (dup.rows.length > 0) throw new HttpError(409, `${mod.rows[0].code} is already booked for ${date} at ${slot}.`);

      const ins = await client.query(
        `INSERT INTO exam_bookings (module_id, venue_id, exam_date, slot, booked_by) VALUES ($1, $2, $3, $4, $5)
         RETURNING id, module_id, venue_id, to_char(exam_date, 'YYYY-MM-DD') AS exam_date, slot`,
        [moduleId, venueId, date, slot, req.user?.email ?? null]
      );
      const booking = ins.rows[0];
      failIfProblems(await assignSeats(client, booking), ven.rows[0].name);

      // Students whose face is not enrolled on a device at this venue will be refused at the door: tell the invigilator now.
      const notReady = await client.query(
        `SELECT s.student_number, s.name FROM seat_reservations r JOIN students s ON s.id = r.student_id
         LEFT JOIN devices d ON d.id = s.device_id
         WHERE r.booking_id = $1 AND NOT (s.enrollment_status = 'enrolled' AND d.venue_id = $2)
         ORDER BY s.student_number`,
        [booking.id, venueId]
      );
      return { booking, notReady: notReady.rows };
    });
    const full = await pool.query(`${LIST_SQL} WHERE b.id = $1`, [out.booking.id]);
    const row = full.rows[0];
    res.status(201).json({ ...row, remaining: row.venue_capacity - row.slot_reserved, notReadyAtVenue: out.notReady });
  } catch (err) { handleDbError(res, err); }
});

// DELETE /api/bookings/:id — cancel; the seats are freed
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM exam_bookings WHERE id = $1 RETURNING id', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'booking not found' });
    res.status(204).send();
  } catch (err) { handleDbError(res, err); }
});

module.exports = router;
