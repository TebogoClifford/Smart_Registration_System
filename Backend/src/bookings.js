// bookings.js — seat reservation rules for exam bookings.
//
// A booking = one module + one venue + one date + one of two fixed slots.
// Several modules may share a venue/date/slot as long as the total seats fit the capacity.
// All functions that change data take a `client` that is already inside a BEGIN...COMMIT.
const SLOTS = ['09:00', '13:00'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Error that the route layer turns into an HTTP response.
class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.name = 'HttpError'; this.status = status; this.extra = extra; }
}

// True for a real calendar date such as 2026-11-03 (rejects 2026-02-31).
function isValidDate(s) {
  if (!DATE_RE.test(String(s))) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Serialise everyone booking the same venue/date/slot, so two invigilators cannot both
// take the last seat. The lock is released automatically at COMMIT/ROLLBACK.
async function lockSession(client, venueId, date, slot) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`session:${venueId}:${date}:${slot}`]);
}

// Capacity, seats taken and seats left for one venue/date/slot.
async function availability(db, venueId, date, slot) {
  const v = await db.query('SELECT id, name, capacity FROM venues WHERE id = $1', [venueId]);
  if (v.rows.length === 0) return null;
  const r = await db.query(
    `SELECT COUNT(*)::int AS n FROM seat_reservations WHERE venue_id = $1 AND exam_date = $2 AND slot = $3`,
    [venueId, date, slot]
  );
  const capacity = v.rows[0].capacity;
  return { venueId: v.rows[0].id, venueName: v.rows[0].name, date, slot, capacity, reserved: r.rows[0].n, remaining: capacity - r.rows[0].n };
}

// Give every student of the booking's module (or just `onlyStudentId`) a seat.
// Never partly succeeds silently: the caller rolls back when `clashes` or `noSeat` is non-empty.
async function assignSeats(client, booking, onlyStudentId = null) {
  await lockSession(client, booking.venue_id, booking.exam_date, booking.slot);
  const cap = await client.query('SELECT capacity FROM venues WHERE id = $1', [booking.venue_id]);
  const capacity = cap.rows[0].capacity;
  const used = new Set((await client.query(
    'SELECT seat_number FROM seat_reservations WHERE venue_id = $1 AND exam_date = $2 AND slot = $3',
    [booking.venue_id, booking.exam_date, booking.slot])).rows.map((r) => r.seat_number));

  const params = [booking.module_id, booking.id];
  let extra = '';
  if (onlyStudentId) { params.push(onlyStudentId); extra = 'AND s.id = $3'; }
  const { rows: students } = await client.query(
    `SELECT s.id, s.student_number, s.name FROM student_modules sm JOIN students s ON s.id = sm.student_id
     WHERE sm.module_id = $1 ${extra}
       AND NOT EXISTS (SELECT 1 FROM seat_reservations r WHERE r.booking_id = $2 AND r.student_id = s.id)
     ORDER BY s.student_number, s.id`,
    params
  );

  const assigned = [], clashes = [], noSeat = [];
  let next = 1;
  for (const st of students) {
    const clash = await client.query(
      `SELECT m.code FROM seat_reservations r JOIN exam_bookings b ON b.id = r.booking_id JOIN modules m ON m.id = b.module_id
       WHERE r.student_id = $1 AND r.exam_date = $2 AND r.slot = $3`,
      [st.id, booking.exam_date, booking.slot]
    );
    if (clash.rows.length > 0) { clashes.push({ ...st, otherModule: clash.rows[0].code }); continue; }
    while (used.has(next)) next++;
    if (next > capacity) { noSeat.push(st); continue; }
    await client.query(
      `INSERT INTO seat_reservations (booking_id, student_id, venue_id, exam_date, slot, seat_number)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [booking.id, st.id, booking.venue_id, booking.exam_date, booking.slot, next]
    );
    used.add(next);
    assigned.push({ ...st, seat: next });
  }
  return { assigned, clashes, noSeat, capacity, free: capacity - used.size };
}

// Turn assignSeats problems into one clear 409 message.
function failIfProblems(result, venueName) {
  const { clashes, noSeat, free } = result;
  if (clashes.length === 0 && noSeat.length === 0) return;
  const parts = [];
  if (noSeat.length > 0) {
    parts.push(`${venueName} does not have enough seats: ${noSeat.length} more student(s) need a seat but only ${Math.max(free, 0)} are free`);
  }
  if (clashes.length > 0) {
    parts.push(`${clashes.length} student(s) already sit another exam in that slot (${clashes.slice(0, 3).map((c) => `${c.student_number} → ${c.otherModule}`).join(', ')}${clashes.length > 3 ? ', …' : ''})`);
  }
  throw new HttpError(409, parts.join('; '), { clashes: clashes.map((c) => ({ studentNumber: c.student_number, name: c.name, otherModule: c.otherModule })), seatsShort: noSeat.length });
}

// Enrol a student in a module; every existing booking of that module gives them a seat or the whole change fails.
async function enrol(client, studentId, moduleId) {
  const ins = await client.query(
    'INSERT INTO student_modules (student_id, module_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING student_id',
    [studentId, moduleId]
  );
  if (ins.rows.length === 0) return; // already enrolled
  const { rows: bookings } = await client.query(
    `SELECT b.*, v.name AS venue_name, to_char(b.exam_date, 'YYYY-MM-DD') AS d FROM exam_bookings b JOIN venues v ON v.id = b.venue_id WHERE b.module_id = $1`,
    [moduleId]
  );
  for (const b of bookings) {
    const result = await assignSeats(client, { ...b, exam_date: b.d }, studentId);
    failIfProblems(result, b.venue_name);
  }
}

// Remove a student from a module and free their seats in that module's bookings.
async function unenrol(client, studentId, moduleId) {
  await client.query(
    `DELETE FROM seat_reservations WHERE student_id = $1 AND booking_id IN (SELECT id FROM exam_bookings WHERE module_id = $2)`,
    [studentId, moduleId]
  );
  await client.query('DELETE FROM student_modules WHERE student_id = $1 AND module_id = $2', [studentId, moduleId]);
}

// Run fn(client) in a transaction; HttpError thrown inside rolls everything back.
async function inTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { SLOTS, isValidDate, HttpError, lockSession, availability, assignSeats, failIfProblems, enrol, unenrol, inTransaction };
