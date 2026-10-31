// seed-exams.js — fills an existing system with exam data: seat counts for halls that have none,
// modules, students registered for those modules, and exam bookings over the next two weeks.
// Unlike seed-demo.js it keeps your own venues and devices and only adds what is missing,
// so it is safe to run more than once.
//
//   BASE_URL=http://localhost:3000 SEED_EMAIL=admin@srs.dev SEED_PASSWORD=... node tools/seed-exams.js
//
// It uses the real HTTP API, so seat reservation and validation behave exactly as in the app.
// Anything except localhost needs CONFIRM_SEED=yes as well.
const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE);
if (!isLocal && process.env.CONFIRM_SEED !== 'yes') {
  console.error(`Refusing to add exam data to ${BASE}. Set CONFIRM_SEED=yes if you really mean it.`);
  process.exit(1);
}

let token = null;
async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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

// Seats for a hall that has none yet, by its name.
const seatsFor = (name) => (/exam\s*hall|hall/i.test(name) ? 120 : /cafeteria|canteen/i.test(name) ? 80 : 60);

const IT = 'National Diploma: Information Technology';
const ENG = 'National Diploma: Computer Systems Engineering';
// Two groups of four modules. Students take three modules of their own course's group,
// so an IT module and an Engineering module never share a student and can sit in one hall together.
const MODULES = {
  [IT]: [['PRG101', 'Programming 1'], ['DBS201', 'Database Systems'], ['WEB201', 'Web Development'], ['NET301', 'Computer Networks']],
  [ENG]: [['MTH101', 'Engineering Mathematics'], ['ELN202', 'Digital Electronics'], ['SYS301', 'Embedded Systems'], ['CTL302', 'Control Systems']],
};
const FIRST = ['Thabo', 'Lerato', 'Sipho', 'Naledi', 'Kagiso', 'Zanele', 'Tshepo', 'Palesa', 'Bongani', 'Nomsa', 'Mpho', 'Refilwe', 'Lwazi', 'Ayanda', 'Katlego',
  'Boitumelo', 'Themba', 'Nthabiseng', 'Siyabonga', 'Dineo', 'Karabo', 'Lindiwe', 'Mandla', 'Precious', 'Tumelo', 'Ofentse', 'Lebo', 'Sibusiso', 'Amahle', 'Kamogelo'];
const LAST = ['Mokoena', 'Dlamini', 'Nkosi', 'Molefe', 'Khumalo', 'Sithole', 'Mahlangu', 'Ndlovu', 'Maseko', 'Radebe', 'Mthembu', 'Tau', 'Mabaso', 'Zulu', 'Baloyi', 'Shabalala', 'Mathebula'];
const PER_COURSE = 30;

// The exam timetable: [weekday number from today (0 = today or the next weekday), session, hall rank (0 = biggest), module codes].
const TIMETABLE = [
  [0, '09:00', 0, ['PRG101', 'MTH101']],
  [1, '09:00', 1, ['DBS201']],
  [1, '13:00', 0, ['ELN202']],
  [3, '09:00', 0, ['WEB201', 'SYS301']],
  [6, '13:00', 2, ['NET301']],
  [8, '09:00', 1, ['CTL302']],
];

// YYYY-MM-DD (South African time) of the n-th weekday from today.
function weekday(n) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' });
  const dow = (d) => new Date(`${fmt.format(d)}T12:00:00Z`).getUTCDay();
  let d = new Date();
  while ([0, 6].includes(dow(d))) d = new Date(d.getTime() + 86400000);
  for (let left = n; left > 0;) {
    d = new Date(d.getTime() + 86400000);
    if (![0, 6].includes(dow(d))) left--;
  }
  return fmt.format(d);
}

async function main() {
  const st = await must('auth status', call('GET', '/api/auth/status'));
  if (st.authRequired) {
    if (!process.env.SEED_EMAIL || !process.env.SEED_PASSWORD) throw new Error('Sign-in is on: set SEED_EMAIL and SEED_PASSWORD (an administrator).');
    token = (await must('sign-in', call('POST', '/api/auth/login', { email: process.env.SEED_EMAIL, password: process.env.SEED_PASSWORD }))).token;
  }

  // 1. halls: give every hall without a seat count one; create halls only if there are none at all
  let venues = await must('venues', call('GET', '/api/venues'));
  if (venues.length === 0) {
    for (const [name, capacity] of [['Exam Hall A', 120], ['Exam Hall B', 80], ['Computer Lab 1', 40]]) {
      venues.push(await must(name, call('POST', '/api/venues', { name, capacity })));
    }
    console.log('Created 3 exam halls.');
  }
  for (const v of venues.filter((x) => !(x.capacity > 0))) {
    const capacity = seatsFor(v.name);
    Object.assign(v, await must(`seats for ${v.name}`, call('PUT', `/api/venues/${v.id}`, { name: v.name, capacity })));
    console.log(`Seats: ${v.name} now has ${capacity}.`);
  }
  const halls = [...venues].sort((a, b) => b.capacity - a.capacity || a.id - b.id);

  // 2. a camera per hall is needed to register students; add one only if there are none
  let devices = await must('devices', call('GET', '/api/devices'));
  if (devices.length === 0) {
    devices = [await must('device', call('POST', '/api/devices', { venue_id: halls[0].id, name: `${halls[0].name} Camera` }))];
    console.log(`Created device ${devices[0].name}.`);
  }

  // 3. modules
  const existingModules = await must('modules', call('GET', '/api/modules'));
  const byCode = new Map(existingModules.map((m) => [m.code, m]));
  for (const [code, name] of Object.values(MODULES).flat()) {
    if (!byCode.has(code)) { byCode.set(code, await must(code, call('POST', '/api/modules', { code, name }))); console.log(`Module ${code} ${name}.`); }
  }

  // 4. students: 30 per course, spread over the devices; existing student numbers are left alone
  const existing = await must('students', call('GET', '/api/students'));
  const byNumber = new Map(existing.map((s) => [s.student_number, s]));
  const seeded = { [IT]: [], [ENG]: [] };
  let added = 0;
  for (const [c, course] of [IT, ENG].entries()) {
    for (let i = 0; i < PER_COURSE; i++) {
      const n = c * PER_COURSE + i;
      const number = String(202510001 + n * 13);
      let s = byNumber.get(number);
      if (!s) {
        s = await must(`student ${number}`, call('POST', '/api/students', {
          student_number: number, name: `${FIRST[n % FIRST.length]} ${LAST[(n * 7) % LAST.length]}`,
          device_id: devices[n % devices.length].id, course_name: course,
        }));
        added++;
      }
      seeded[course].push(s);
    }
  }
  console.log(`Students: ${added} added (${existing.length} were already there).`);

  // 5. module registrations: three of the four modules of the student's course.
  //    Students who were already in the system take the first two IT modules.
  const members = new Map([...byCode.keys()].map((code) => [code, []]));
  for (const course of [IT, ENG]) {
    seeded[course].forEach((s, i) => MODULES[course].forEach(([code], k) => { if (k !== i % 4) members.get(code).push(s.id); }));
  }
  const others = existing.filter((s) => !/^2025\d{5}$/.test(s.student_number));
  for (const [code] of MODULES[IT].slice(0, 2)) members.get(code).push(...others.map((s) => s.id));
  for (const [code, ids] of members) {
    if (ids.length === 0) continue;
    await must(`register ${code}`, call('POST', `/api/modules/${byCode.get(code).id}/students`, { studentIds: ids }));
  }
  console.log('Module registrations done.');

  // 6. exam bookings (modules that already have a booking are left alone)
  const modules = new Map((await must('modules', call('GET', '/api/modules'))).map((m) => [m.code, m]));
  for (const [day, slot, rank, codes] of TIMETABLE) {
    const hall = halls[Math.min(rank, halls.length - 1)];
    for (const code of codes) {
      const m = modules.get(code);
      if (m.booking_count > 0) { console.log(`${code} is already booked.`); continue; }
      const r = await call('POST', '/api/bookings', { moduleId: m.id, venueId: hall.id, date: weekday(day), slot });
      console.log(r.status < 400
        ? `Booked ${code} (${r.json.seats} seats) in ${hall.name} on ${weekday(day)} at ${slot}; ${r.json.remaining} of ${hall.capacity} seats left.`
        : `Could not book ${code}: ${r.json?.error}`);
    }
  }
  console.log('\nDone.');
}
main().catch((e) => { console.error('Seeding failed:', e.message); process.exit(1); });
