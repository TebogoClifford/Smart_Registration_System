// signout.js — automatic sign-out: when an exam session ends (12:00 / 16:00, see SESSION_ENDS in
// bookings.js) every student let in during it gets a 'signed_out' access event, timed at the session's
// end and logged on the device that let them in. A student may then be let in again in a later session.
const { sessionAt, sessionEnd } = require('./bookings');

const LOOK_BACK_MS = 7 * 86400000;  // a server that slept for days still catches up on this week
const EVERY_MS = 60 * 1000;
let lastRun = 0;

// Add the sign-out events that are due. Returns how many were added.
async function signOutEnded(db, now = new Date()) {
  const granted = await db.access_events.findMany({
    where: { decision: 'granted', student_id: { not: null }, event_time: { gte: new Date(now - LOOK_BACK_MS), lte: now } },
    select: { device_id: true, student_id: true, event_time: true },
  });
  const due = new Map();
  for (const g of granted) {
    const s = sessionAt(g.event_time);
    const end = sessionEnd(s);
    if (end > now) continue;  // still in the exam
    if (g.event_time >= end) continue;  // let in after the session ended (door PC Admin mode): nothing to sign out of
    const key = `signout:${s.date}:${s.slot}:${g.student_id}`;
    if (!due.has(key)) {
      due.set(key, { device_id: g.device_id, student_id: g.student_id, decision: 'signed_out', event_time: end, client_event_id: key });
    }
  }
  if (!due.size) return 0;
  const done = await db.access_events.findMany({ where: { client_event_id: { in: [...due.keys()] } }, select: { client_event_id: true } });
  for (const d of done) due.delete(d.client_event_id);
  if (!due.size) return 0;
  const { count } = await db.access_events.createMany({ data: [...due.values()], skipDuplicates: true });
  return count;
}

// For read routes: sign out first so lists are current, at most once every 20 seconds.
async function signOutIfDue(db) {
  if (Date.now() - lastRun < 20000) return;
  lastRun = Date.now();
  try {
    await signOutEnded(db);
  } catch (err) {
    console.error('Automatic sign-out failed:', err.message);
  }
}

// A new entry was recorded: the next read checks again straight away.
function signOutSoon() {
  lastRun = 0;
}

// Runs once now and then every minute while the server is up.
function startSignOutTimer(db) {
  const run = () => signOutEnded(db)
    .then((n) => { lastRun = Date.now(); if (n) console.log(`Signed out ${n} student(s): their exam session ended`); })
    .catch((err) => console.error('Automatic sign-out failed:', err.message));
  run();
  setInterval(run, EVERY_MS).unref();
}

module.exports = { signOutEnded, signOutIfDue, signOutSoon, startSignOutTimer };
