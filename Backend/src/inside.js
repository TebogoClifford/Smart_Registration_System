// inside.js — "already inside": a student is let in once per exam session (a day's 09:00 or 13:00 slot).
// A later recognition in the same session is recorded with decision 'already' instead of 'granted'.
const { sessionAt } = require('./bookings');

const DAY_MS = 86400000;
const sameSession = (a, b) => a.date === b.date && a.slot === b.slot;

// Granted events of `studentIds` (or everyone) near `session`, kept only when they fall in that session.
// The time window is padded a day either side so the local-time slot rule decides, not UTC.
async function grantedIn(db, session, studentIds) {
  const day = new Date(`${session.date}T00:00:00Z`).getTime();
  const rows = await db.access_events.findMany({
    where: {
      decision: 'granted', student_id: studentIds ? { in: studentIds } : { not: null },
      event_time: { gte: new Date(day - DAY_MS), lt: new Date(day + 2 * DAY_MS) },
    },
    select: { student_id: true, event_time: true },
  });
  return rows.filter((r) => r.event_time && sameSession(sessionAt(r.event_time), session));
}

// True when the student was already granted in the session that `when` falls in.
async function wasLetIn(db, studentId, when) {
  return (await grantedIn(db, sessionAt(when), [studentId])).length > 0;
}

// Ids of every student already let in during `session` ({ date, slot }).
async function insideIds(db, session) {
  return [...new Set((await grantedIn(db, session)).map((r) => r.student_id))];
}

module.exports = { wasLetIn, insideIds };
