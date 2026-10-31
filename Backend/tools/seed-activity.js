// seed-activity.js — adds SAMPLE access events for the last 7 days so the dashboard's Access
// activity chart and Venue activity have something to show. Events are uploaded the way a door
// device does it (POST /api/access-events/batch with the device's key), around the 09:00 and 13:00
// exam sessions: mostly granted, some denied, a few errors and "already inside" re-scans.
//
//   BASE_URL=http://localhost:3000 SEED_EMAIL=admin@srs.dev SEED_PASSWORD=... node tools/seed-activity.js
//
// Safe to run again: every event has a fixed clientEventId starting with "demo-", so repeats are
// ignored by the server. To remove them all later (database console):
//   DELETE FROM access_events WHERE client_event_id LIKE 'demo-%';
// Anything except localhost needs CONFIRM_SEED=yes as well.
const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE);
if (!isLocal && process.env.CONFIRM_SEED !== 'yes') {
  console.error(`Refusing to add sample events to ${BASE}. Set CONFIRM_SEED=yes if you really mean it.`);
  process.exit(1);
}
const DAYS = 7;
const TZ_OFFSET = '+02:00'; // South African time (no daylight saving)

let token = null;
async function call(method, path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* empty body */ }
  return { status: res.status, json };
}
const must = async (label, p) => {
  const r = await p;
  if (r.status >= 400) throw new Error(`${label}: ${r.status} ${r.json?.error ?? ''}`);
  return r.json;
};

// A small seeded random generator, so a given day always produces the same events.
function rng(seedText) {
  let h = 2166136261;
  for (const c of seedText) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
}
const saDate = (msAgo) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date(Date.now() - msAgo));

async function main() {
  const st = await must('auth status', call('GET', '/api/auth/status'));
  if (st.authRequired) {
    if (!process.env.SEED_EMAIL || !process.env.SEED_PASSWORD) throw new Error('Sign-in is on: set SEED_EMAIL and SEED_PASSWORD (an administrator).');
    token = (await must('sign-in', call('POST', '/api/auth/login', { email: process.env.SEED_EMAIL, password: process.env.SEED_PASSWORD }))).token;
  }
  const devices = [];
  for (const d of await must('devices', call('GET', '/api/devices'))) {
    const full = await must(`device ${d.id}`, call('GET', `/api/devices/${d.id}`));
    if (full.api_key) devices.push(full);
  }
  if (!devices.length) throw new Error('No device keys visible: sign in as an administrator.');
  const students = (await must('students', call('GET', '/api/students'))).map((s) => s.id);
  if (!students.length) throw new Error('No students yet: run tools/seed-exams.js first.');

  let created = 0, repeats = 0;
  for (let ago = DAYS - 1; ago >= 0; ago--) {
    const date = saDate(ago * 86400000);
    const weekend = [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay());
    for (const [n, dev] of devices.entries()) {
      const rand = rng(`${date}|${dev.id}`);
      const busy = n === 0 ? 1 : 0.45; // the first device (the main hall) is the busiest
      const count = Math.round((weekend ? 6 + rand() * 6 : 28 + rand() * 30) * busy);
      const seen = { '09:00': new Set(), '13:00': new Set() };
      const events = [];
      for (let i = 0; i < count; i++) {
        // arrivals cluster before each session: 08:15-09:20 and 12:15-13:20
        const morning = rand() < 0.6;
        const minutes = (morning ? 8 * 60 + 15 : 12 * 60 + 15) + Math.floor(rand() * 65);
        const at = new Date(`${date}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:${String(Math.floor(rand() * 60)).padStart(2, '0')}${TZ_OFFSET}`);
        if (at.getTime() > Date.now() - 60000) continue; // never in the future
        const session = seen[morning ? '09:00' : '13:00'];
        const r = rand();
        let e;
        if (r < 0.08) e = { decision: 'denied' };                     // face not recognised
        else if (r < 0.11) e = { decision: 'error' };                 // could not capture
        else if (r < 0.14 && session.size) e = { decision: 'granted', studentId: [...session][Math.floor(rand() * session.size)] }; // re-scan -> "already inside"
        else {
          let sid = students[Math.floor(rand() * students.length)];
          for (let tries = 0; session.has(sid) && tries < 5; tries++) sid = students[Math.floor(rand() * students.length)];
          session.add(sid);
          e = { decision: 'granted', studentId: sid };
        }
        events.push({ ...e, clientEventId: `demo-${date}-${dev.id}-${i}`, timestamp: at.toISOString() });
      }
      // upload oldest first (so a re-scan comes after the first entry), at most 100 per request
      events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      for (let i = 0; i < events.length; i += 100) {
        const r = await must('upload', call('POST', '/api/access-events/batch', { deviceId: dev.id, events: events.slice(i, i + 100) }, { 'X-Device-Key': dev.api_key }));
        for (const x of r.results) { if (x.status === 'created') created++; else if (x.status === 'duplicate') repeats++; else console.log('rejected:', x.error); }
      }
      console.log(`${date} ${dev.name}: ${events.length} sample events`);
    }
  }
  console.log(`\nDone: ${created} added, ${repeats} were already there.`);
}
main().catch((e) => { console.error('Seeding failed:', e.message); process.exit(1); });
