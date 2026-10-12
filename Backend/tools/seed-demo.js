// seed-demo.js — fills a running backend with DEMO data (venues, devices, modules, students,
// exam bookings, access events and two invigilator accounts) so every screen has something to show.
// It uses the real HTTP API, so seat reservation and validation behave exactly as in the app.
//
//   BASE_URL=http://localhost:3000 SEED_EMAIL=admin@demo.local SEED_PASSWORD='Admin#2026' node tools/seed-demo.js
//
// Safe to run twice: it stops if "Demo Main Hall" already exists.
// It refuses to run against anything except localhost unless you also set CONFIRM_SEED=yes
// (so you cannot fill your real Render/Neon database with fake students by accident).
const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE);
if (!isLocal && process.env.CONFIRM_SEED !== 'yes') {
  console.error(`Refusing to add demo data to ${BASE}. Set CONFIRM_SEED=yes if you really mean it.`);
  process.exit(1);
}

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

// Date helper: YYYY-MM-DD in South African time, `plus` days from today.
const day = (plus) => {
  const d = new Date(Date.now() + plus * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(d);
};

const FIRST = ['Thabo', 'Lerato', 'Sipho', 'Naledi', 'Kagiso', 'Zanele', 'Tshepo', 'Palesa', 'Bongani', 'Nomsa', 'Mpho', 'Refilwe', 'Lwazi', 'Ayanda', 'Katlego', 'Boitumelo', 'Themba', 'Nthabiseng', 'Siyabonga', 'Dineo'];
const LAST = ['Mokoena', 'Dlamini', 'Nkosi', 'Molefe', 'Khumalo', 'Sithole', 'Mahlangu', 'Ndlovu', 'Maseko', 'Radebe', 'Mthembu', 'Tau'];
const COURSES = ['National Diploma: Computer Systems Engineering', 'National Diploma: Information Technology'];
const MODULES = [
  ['PRG101', 'Programming 1'], ['DBS201', 'Database Systems'], ['NET301', 'Computer Networks'],
  ['ELN202', 'Digital Electronics'], ['MTH101', 'Engineering Mathematics'], ['SYS301', 'Embedded Systems'],
];

async function main() {
  const st = await must('auth status', call('GET', '/api/auth/status'));
  if (st.authRequired) {
    if (!process.env.SEED_EMAIL || !process.env.SEED_PASSWORD) throw new Error('Sign-in is on: set SEED_EMAIL and SEED_PASSWORD (an administrator).');
    token = (await must('sign-in', call('POST', '/api/auth/login', { email: process.env.SEED_EMAIL, password: process.env.SEED_PASSWORD }))).token;
  }
  const venues = await must('venues', call('GET', '/api/venues'));
  if (venues.some((v) => v.name === 'Demo Main Hall')) { console.log('Demo data is already there. Nothing to do.'); return; }

  // 1. invigilator accounts (only meaningful when sign-in is on, harmless otherwise)
  const accounts = [['nomsa@demo.local', 'Nomsa Dlamini'], ['pieter@demo.local', 'Pieter van Wyk']];
  for (const [email, name] of accounts) {
    const r = await call('POST', '/api/users', { email, name, password: 'Invigilator#2026', role: 'invigilator' });
    if (r.status >= 400 && r.status !== 409) throw new Error(`user ${email}: ${r.status} ${r.json?.error}`);
  }

  // 2. venues + one device each
  const halls = [['Demo Main Hall', 120], ['Demo Lab 4', 40], ['Demo Annex B', 60]];
  const venueRows = []; const devices = [];
  for (const [name, capacity] of halls) {
    const v = await must(name, call('POST', '/api/venues', { name, capacity }));
    venueRows.push(v);
    const d = await must(`device for ${name}`, call('POST', '/api/devices', { venue_id: v.id, name: `${name} Camera` }));
    devices.push(await must('device key', call('GET', `/api/devices/${d.id}`)));
  }
  const dkey = (d) => ({ 'X-Device-Key': d.api_key });

  // 3. modules
  const mods = [];
  for (const [code, name] of MODULES) mods.push(await must(code, call('POST', '/api/modules', { code, name })));

  // 4. students (40): most enrolled on the Main Hall camera, some on the others, a few not finished
  const students = [];
  for (let i = 0; i < 40; i++) {
    const dev = devices[i % 5 === 0 ? 1 : i % 7 === 0 ? 2 : 0];
    const s = await must(`student ${i}`, call('POST', '/api/students', {
      student_number: String(220100000 + i * 37), name: `${FIRST[i % FIRST.length]} ${LAST[(i * 5) % LAST.length]}`,
      device_id: dev.id, course_name: COURSES[i % 2],
    }));
    students.push({ ...s, dev });
    if (i < 34) await must('enrol', call('PUT', `/api/students/${s.id}/enrollment`, { status: 'enrolled' }, dkey(dev)));
    else if (i === 34) await must('failed', call('PUT', `/api/students/${s.id}/enrollment`, { status: 'failed' }, dkey(dev)));
    // 35..39 stay "pending" so the Enrollment page has a queue
  }

  // 5. module registrations: 2-3 modules each
  const members = mods.map(() => []);
  students.forEach((s, i) => {
    new Set([i % 6, (i + 2) % 6, ...(i % 3 === 0 ? [(i + 3) % 6] : [])]).forEach((m) => members[m].push(s.id));
  });
  for (let m = 0; m < mods.length; m++) await must(`link ${mods[m].code}`, call('POST', `/api/modules/${mods[m].id}/students`, { studentIds: members[m] }));

  // 6. bookings over the next few days
  // (module index, venue index, days from today, slot). PRG101 and DBS201 share the Main Hall in one session.
  const plan = [[0, 0, 1, '09:00'], [1, 0, 1, '09:00'], [2, 0, 1, '13:00'], [3, 1, 3, '09:00'], [4, 2, 2, '13:00'], [5, 0, 2, '09:00']];
  for (const [m, v, plus, slot] of plan) {
    const r = await call('POST', '/api/bookings', { moduleId: mods[m].id, venueId: venueRows[v].id, date: day(plus), slot });
    console.log(r.status < 400 ? `booked ${mods[m].code} in ${venueRows[v].name} ${day(plus)} ${slot}` : `skipped ${mods[m].code}: ${r.json?.error}`);
  }

  // 7. access events from the Main Hall camera over the last few hours (batch upload)
  const door = devices[0];
  const people = students.filter((s) => s.dev.id === door.id).slice(0, 25);
  const events = [];
  people.forEach((s, i) => events.push({ clientEventId: `demo-${i}`, decision: i % 9 === 4 ? 'denied' : 'granted', studentId: i % 9 === 4 ? undefined : s.id, secondsAgo: 600 + i * 420 }));
  events.push({ clientEventId: 'demo-err-1', decision: 'error', secondsAgo: 900 }, { clientEventId: 'demo-deny-x', decision: 'denied', secondsAgo: 300 });
  await must('events', call('POST', '/api/access-events/batch', { deviceId: door.id, events }, dkey(door)));

  console.log('\nDemo data created.');
  console.log(`  Venues: ${venueRows.length}, devices: ${devices.length}, modules: ${mods.length}, students: ${students.length}, events: ${events.length}`);
  if (st.authRequired) console.log('  Extra sign-ins: nomsa@demo.local and pieter@demo.local, password Invigilator#2026');
  console.log(`  Device keys (for tools/device-simulator.js): device ${door.id} -> ${door.api_key}`);
}
main().catch((e) => { console.error('Seed failed:', e.message); process.exit(1); });
