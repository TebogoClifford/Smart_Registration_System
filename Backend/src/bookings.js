// bookings.js — seat reservation rules for exam bookings.
//
// A booking = one module + one venue + one date + one of two fixed slots.
// Several modules may share a venue/date/slot as long as the total seats fit the capacity.
// All functions that change data take `tx`, a Prisma transaction client (see inTransaction).
const { toDbDate } = require('./http');

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
// take the last seat. The lock is released automatically when the transaction ends.
async function lockSession(tx, venueId, date, slot) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`session:${venueId}:${date}:${slot}`}))`;
}

// One venue/date/slot, as a Prisma filter on seat_reservations.
const sessionWhere = (venueId, date, slot) => ({ venue_id: Number(venueId), exam_date: toDbDate(date), slot });

// Capacity, seats taken and seats left for one venue/date/slot.
async function availability(db, venueId, date, slot) {
  const v = await db.venues.findUnique({ where: { id: Number(venueId) }, select: { id: true, name: true, capacity: true } });
  if (!v) return null;
  const reserved = await db.seat_reservations.count({ where: sessionWhere(venueId, date, slot) });
  return { venueId: v.id, venueName: v.name, date, slot, capacity: v.capacity, reserved, remaining: v.capacity - reserved };
}

// Give every student of the booking's module (or just `onlyStudentId`) a seat.
// booking = { id, module_id, venue_id, exam_date: 'YYYY-MM-DD', slot }.
// Never partly succeeds silently: the caller rolls back when `clashes` or `noSeat` is non-empty.
async function assignSeats(tx, booking, onlyStudentId = null) {
  await lockSession(tx, booking.venue_id, booking.exam_date, booking.slot);
  const { capacity } = await tx.venues.findUnique({ where: { id: booking.venue_id }, select: { capacity: true } });
  const taken = await tx.seat_reservations.findMany({
    where: sessionWhere(booking.venue_id, booking.exam_date, booking.slot), select: { seat_number: true },
  });
  const used = new Set(taken.map((r) => r.seat_number));

  // students of the module who do not have a seat in this booking yet
  const members = await tx.student_modules.findMany({
    where: {
      module_id: booking.module_id,
      ...(onlyStudentId && { student_id: onlyStudentId }),
      students: { seat_reservations: { none: { booking_id: booking.id } } },
    },
    select: { students: { select: { id: true, student_number: true, name: true } } },
    orderBy: [{ students: { student_number: 'asc' } }, { student_id: 'asc' }],
  });

  const assigned = [], clashes = [], noSeat = [];
  let next = 1;
  for (const { students: st } of members) {
    const clash = await tx.seat_reservations.findFirst({
      where: { student_id: st.id, exam_date: toDbDate(booking.exam_date), slot: booking.slot },
      select: { exam_bookings: { select: { modules: { select: { code: true } } } } },
    });
    if (clash) { clashes.push({ ...st, otherModule: clash.exam_bookings.modules.code }); continue; }
    while (used.has(next)) next++;
    if (next > capacity) { noSeat.push(st); continue; }
    await tx.seat_reservations.create({
      data: {
        booking_id: booking.id, student_id: st.id, venue_id: booking.venue_id,
        exam_date: toDbDate(booking.exam_date), slot: booking.slot, seat_number: next,
      },
    });
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
async function enrol(tx, studentId, moduleId) {
  const { count } = await tx.student_modules.createMany({ data: [{ student_id: studentId, module_id: moduleId }], skipDuplicates: true });
  if (count === 0) return; // already enrolled
  const bookings = await tx.exam_bookings.findMany({
    where: { module_id: moduleId },
    select: { id: true, module_id: true, venue_id: true, exam_date: true, slot: true, venues: { select: { name: true } } },
  });
  for (const b of bookings) {
    const result = await assignSeats(tx, { ...b, exam_date: b.exam_date.toISOString().slice(0, 10) }, studentId);
    failIfProblems(result, b.venues.name);
  }
}

// Remove a student from a module and free their seats in that module's bookings.
async function unenrol(tx, studentId, moduleId) {
  await tx.seat_reservations.deleteMany({ where: { student_id: studentId, exam_bookings: { module_id: moduleId } } });
  await tx.student_modules.deleteMany({ where: { student_id: studentId, module_id: moduleId } });
}

// Run fn(tx) in one database transaction; an error thrown inside (HttpError too) rolls everything back.
// Seating a whole module is many small queries, so allow longer than Prisma's 5 s default.
const inTransaction = (prisma, fn) => prisma.$transaction(fn, { maxWait: 10000, timeout: 60000 });

module.exports = { SLOTS, isValidDate, HttpError, lockSession, availability, assignSeats, failIfProblems, enrol, unenrol, inTransaction };
