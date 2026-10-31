// Capacity, modules and exam booking tests — against an AUTH_DISABLED=true server, run with: BASE_URL=http://localhost:3111 node --test test/booking.test.js
const { test } = require('node:test');
const assert = require('node:assert');

const BASE = process.env.BASE_URL || 'http://localhost:3111';
const call = async (method, path, body, headers = {}) => {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
};
const tag = Date.now().toString(36).toUpperCase();
const ctx = { students: [] };
const DAY = '2031-03-04';
const dkey = () => ({ 'X-Device-Key': ctx.device.api_key });
const IT = 'National Diploma: Information Technology';

test('setup: venues (small hall of 5, big hall of 40), device, 6 students', async () => {
  ctx.small = (await call('POST', '/api/venues', { name: `Small ${tag}`, capacity: 5 })).json;
  ctx.big = (await call('POST', '/api/venues', { name: `Big ${tag}`, capacity: 40 })).json;
  assert.strictEqual(ctx.small.capacity, 5);
  ctx.device = (await call('POST', '/api/devices', { venue_id: ctx.big.id, name: `Cam ${tag}` })).json;
  for (let i = 1; i <= 6; i++) {
    const r = await call('POST', '/api/students', { student_number: `${tag}${i}`, name: `Student ${i}`, device_id: ctx.device.id, course_name: IT });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.json.course_name, IT);
    assert.ok(!('enrollment_image' in r.json), 'photo bytes must never be returned');
    assert.strictEqual(r.json.has_image, false);
    ctx.students.push(r.json);
  }
});

test('courses: only courses from the list are accepted', async () => {
  const courses = (await call('GET', '/api/courses')).json;
  assert.ok(courses.includes(IT) && courses.length === 6);
  const bad = await call('POST', '/api/students', { student_number: `${tag}X`, name: 'X', device_id: ctx.device.id, course_name: 'Diploma IT' });
  assert.strictEqual(bad.status, 400);
  assert.match(bad.json.error, /course_name must be one of/);
  const s = ctx.students[0];
  const edit = (course_name) => call('PUT', `/api/students/${s.id}`, { student_number: s.student_number, name: s.name, device_id: ctx.device.id, course_name });
  assert.strictEqual((await edit('Made-up course')).status, 400);
  assert.strictEqual((await edit(courses[0])).json.course_name, courses[0]);
  assert.strictEqual((await edit('')).json.course_name, null);
  assert.strictEqual((await edit(IT)).json.course_name, IT);
});

test('recognitions: latest recognised students with details, newest first', async () => {
  const [a, b] = ctx.students;
  for (const s of [a, b]) {
    assert.strictEqual((await call('POST', '/api/access-events', { deviceId: ctx.device.id, decision: 'granted', studentId: s.id }, dkey())).status, 201);
  }
  await call('POST', '/api/access-events', { deviceId: ctx.device.id, decision: 'denied' }, dkey()); // unknown face: not listed
  const list = (await call('GET', '/api/access-events/recognitions?limit=2')).json;
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].student.id, b.id);
  assert.strictEqual(list[1].student.id, a.id);
  assert.strictEqual(list[0].student.course, IT);
  assert.strictEqual(list[0].device.id, ctx.device.id);
  assert.strictEqual(list[0].venue.id, ctx.big.id);
  assert.strictEqual(list[0].seat, null); // no exam booked in the session running now
  assert.match(list[0].session.slot, /^(09|13):00$/);
});

test('a student let in once is "already inside" when recognised again in the same session', async () => {
  const [a, b] = ctx.students; // both were let in by the recognitions test above
  const again = await call('POST', '/api/access-events', { deviceId: ctx.device.id, decision: 'granted', studentId: a.id }, dkey());
  assert.strictEqual(again.status, 201);
  assert.strictEqual(again.json.decision, 'already');
  const latest = (await call('GET', '/api/access-events/recognitions?limit=1')).json[0];
  assert.strictEqual(latest.student.id, a.id);
  assert.strictEqual(latest.decision, 'already');
  // the door device learns who is already inside, so a restarted device still knows
  const session = (await call('GET', `/api/devices/${ctx.device.id}/session`, undefined, dkey())).json;
  assert.ok(session.alreadyInside.includes(a.id) && session.alreadyInside.includes(b.id));
  assert.ok(!session.alreadyInside.includes(ctx.students[2].id));
  // the next session (other slot) starts fresh: a past session's entry does not count
  const otherSlot = session.slot === '09:00' ? '13:00' : '09:00';
  const other = (await call('GET', `/api/devices/${ctx.device.id}/session?date=${session.date}&slot=${otherSlot}`, undefined, dkey())).json;
  assert.ok(!other.alreadyInside.includes(a.id));
  assert.ok((await call('GET', '/api/stats')).json.alreadyInside >= 1);
});

test('venue: capacity is required and must be a whole number 1..10000', async () => {
  for (const capacity of [undefined, 0, -3, 1.5, '20', 10001]) {
    assert.strictEqual((await call('POST', '/api/venues', { name: 'Bad', capacity })).status, 400, String(capacity));
  }
});

test('modules: create, duplicate code -> 409, code is normalised', async () => {
  let r = await call('POST', '/api/modules', { code: `a${tag} 1`, name: 'Algorithms' });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.json.code, `A${tag}1`);
  ctx.modA = r.json;
  assert.strictEqual((await call('POST', '/api/modules', { code: `A${tag}1`, name: 'Again' })).status, 409);
  ctx.modB = (await call('POST', '/api/modules', { code: `B${tag}`, name: 'Databases' })).json;
  ctx.modC = (await call('POST', '/api/modules', { code: `C${tag}`, name: 'Networks' })).json;
  assert.strictEqual((await call('POST', '/api/modules', { code: '', name: 'x' })).status, 400);
});

test('enrol students in modules from the student side and the module side', async () => {
  const ids = ctx.students.map((s) => s.id);
  // module A: students 1-3 (via module endpoint)
  assert.strictEqual((await call('POST', `/api/modules/${ctx.modA.id}/students`, { studentIds: ids.slice(0, 3) })).status, 204);
  // module B: students 4-5 (via student endpoint)
  for (const id of ids.slice(3, 5)) {
    const r = await call('PUT', `/api/students/${id}/modules`, { moduleIds: [ctx.modB.id] });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json[0].code, ctx.modB.code);
  }
  const list = (await call('GET', `/api/modules/${ctx.modA.id}/students`)).json;
  assert.strictEqual(list.length, 3);
  assert.strictEqual((await call('GET', '/api/students')).json.find((s) => s.id === ids[0]).modules[0].code, ctx.modA.code);
  assert.strictEqual((await call('PUT', `/api/students/${ids[0]}/modules`, { moduleIds: ['x'] })).status, 400);
  assert.strictEqual((await call('PUT', `/api/students/${ids[0]}/modules`, { moduleIds: [999999] })).status, 400);
});

test('booking validation: bad slot / date / ids', async () => {
  const ok = { moduleId: ctx.modA.id, venueId: ctx.big.id, date: DAY, slot: '09:00' };
  assert.strictEqual((await call('POST', '/api/bookings', { ...ok, slot: '10:00' })).status, 400);
  assert.strictEqual((await call('POST', '/api/bookings', { ...ok, date: '2031-02-31' })).status, 400);
  assert.strictEqual((await call('POST', '/api/bookings', { ...ok, date: 'tomorrow' })).status, 400);
  assert.strictEqual((await call('POST', '/api/bookings', { ...ok, moduleId: 'x' })).status, 400);
  assert.strictEqual((await call('POST', '/api/bookings', { ...ok, moduleId: 999999 })).status, 404);
  assert.strictEqual((await call('POST', '/api/bookings', { ...ok, venueId: 999999 })).status, 404);
});

test('booking a module reserves a seat for every enrolled student (seats 1..3 by student number)', async () => {
  const r = await call('POST', '/api/bookings', { moduleId: ctx.modA.id, venueId: ctx.big.id, date: DAY, slot: '09:00' });
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  ctx.bookA = r.json;
  assert.strictEqual(r.json.seats, 3);
  assert.strictEqual(r.json.remaining, 37);
  const d = (await call('GET', `/api/bookings/${ctx.bookA.id}`)).json;
  assert.deepStrictEqual(d.seatList.map((s) => s.seat_number), [1, 2, 3]);
  assert.deepStrictEqual(d.seatList.map((s) => s.student_number), ctx.students.slice(0, 3).map((s) => s.student_number));
});

test('same module, date and slot cannot be booked twice', async () => {
  const r = await call('POST', '/api/bookings', { moduleId: ctx.modA.id, venueId: ctx.small.id, date: DAY, slot: '09:00' });
  assert.strictEqual(r.status, 409);
});

test('two modules share one hall and get different seats; availability shows what is left', async () => {
  const r = await call('POST', '/api/bookings', { moduleId: ctx.modB.id, venueId: ctx.big.id, date: DAY, slot: '09:00' });
  assert.strictEqual(r.status, 201);
  ctx.bookB = r.json;
  assert.strictEqual(r.json.remaining, 35);
  const d = (await call('GET', `/api/bookings/${ctx.bookB.id}`)).json;
  assert.deepStrictEqual(d.seatList.map((s) => s.seat_number), [4, 5]);
  const a = (await call('GET', `/api/bookings/availability?venueId=${ctx.big.id}&date=${DAY}&slot=09:00`)).json;
  assert.strictEqual(a.capacity, 40); assert.strictEqual(a.reserved, 5); assert.strictEqual(a.remaining, 35);
  assert.strictEqual(a.bookings.length, 2);
  const other = (await call('GET', `/api/bookings/availability?venueId=${ctx.big.id}&date=${DAY}&slot=13:00`)).json;
  assert.strictEqual(other.remaining, 40);
  assert.strictEqual((await call('GET', `/api/bookings/availability?venueId=${ctx.big.id}&date=${DAY}&slot=11:00`)).status, 400);
});

test('booking is refused when students do not fit; nothing is half-booked', async () => {
  // module C gets all 6 students; the small hall holds 5
  await call('POST', `/api/modules/${ctx.modC.id}/students`, { studentIds: ctx.students.map((s) => s.id) });
  const r = await call('POST', '/api/bookings', { moduleId: ctx.modC.id, venueId: ctx.small.id, date: '2031-03-05', slot: '09:00' });
  assert.strictEqual(r.status, 409);
  assert.match(r.json.error, /enough seats/);
  assert.strictEqual((await call('GET', `/api/bookings?date=2031-03-05`)).json.length, 0);
  assert.strictEqual((await call('GET', `/api/bookings/availability?venueId=${ctx.small.id}&date=2031-03-05&slot=09:00`)).json.reserved, 0);
});

test('a student who already sits another exam in the same slot is a clash', async () => {
  // students 1-3 already sit module A at 09:00 on DAY; module C includes them
  const r = await call('POST', '/api/bookings', { moduleId: ctx.modC.id, venueId: ctx.big.id, date: DAY, slot: '09:00' });
  assert.strictEqual(r.status, 409);
  assert.match(r.json.error, /already sit another exam/);
  assert.ok(r.json.clashes.length >= 3);
  // the other slot is fine
  assert.strictEqual((await call('POST', '/api/bookings', { moduleId: ctx.modC.id, venueId: ctx.big.id, date: DAY, slot: '13:00' })).status, 201);
});

test('bookings can be listed for a date range (calendar month)', async () => {
  const mine = (rows) => rows.filter((b) => b.venue_id === ctx.big.id);
  assert.strictEqual(mine((await call('GET', `/api/bookings?from=${DAY}&to=${DAY}`)).json).length, 3);
  assert.strictEqual(mine((await call('GET', '/api/bookings?from=2031-03-01&to=2031-03-31')).json).length, 3);
  assert.strictEqual(mine((await call('GET', '/api/bookings?from=2031-03-05')).json).length, 0);
  assert.strictEqual(mine((await call('GET', '/api/bookings?to=2031-03-03')).json).length, 0);
  assert.strictEqual((await call('GET', '/api/bookings?from=2031-03-31&to=2031-03-01')).status, 400);
  assert.strictEqual((await call('GET', '/api/bookings?from=2031-02-31')).status, 400);
  assert.strictEqual((await call('GET', `/api/bookings?date=${DAY}&from=${DAY}`)).status, 400);
});

test('enrolling a student later in a booked module gives them the next free seat', async () => {
  const late = (await call('POST', '/api/students', { student_number: `${tag}L`, name: 'Late', device_id: ctx.device.id })).json;
  assert.strictEqual((await call('PUT', `/api/students/${late.id}/modules`, { moduleIds: [ctx.modA.id] })).status, 200);
  const d = (await call('GET', `/api/bookings/${ctx.bookA.id}`)).json;
  assert.strictEqual(d.seats, 4);
  assert.ok(d.seatList.some((s) => s.student_number === `${tag}L`));
  // removing them frees the seat again
  await call('PUT', `/api/students/${late.id}/modules`, { moduleIds: [] });
  assert.strictEqual((await call('GET', `/api/bookings/${ctx.bookA.id}`)).json.seats, 3);
});

test('enrolling into a booked module is refused (and rolled back) when the hall is full', async () => {
  // small hall of 5: book module D with 5 students, then try to add a 6th
  const modD = (await call('POST', '/api/modules', { code: `D${tag}`, name: 'Full' })).json;
  await call('POST', `/api/modules/${modD.id}/students`, { studentIds: ctx.students.slice(0, 5).map((s) => s.id) });
  assert.strictEqual((await call('POST', '/api/bookings', { moduleId: modD.id, venueId: ctx.small.id, date: '2031-04-01', slot: '13:00' })).status, 201);
  const r = await call('POST', `/api/modules/${modD.id}/students`, { studentIds: [ctx.students[5].id] });
  assert.strictEqual(r.status, 409);
  assert.strictEqual((await call('GET', `/api/modules/${modD.id}/students`)).json.length, 5);
});

test('venue capacity cannot drop below reserved seats; venue with bookings cannot be deleted', async () => {
  let r = await call('PUT', `/api/venues/${ctx.small.id}`, { name: ctx.small.name, capacity: 3 });
  assert.strictEqual(r.status, 409);
  r = await call('PUT', `/api/venues/${ctx.small.id}`, { name: ctx.small.name, capacity: 8 });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await call('DELETE', `/api/venues/${ctx.small.id}`)).status, 409);
});

test('module with bookings cannot be deleted; cancelling a booking frees seats', async () => {
  assert.strictEqual((await call('DELETE', `/api/modules/${ctx.modB.id}`)).status, 409);
  assert.strictEqual((await call('DELETE', `/api/bookings/${ctx.bookB.id}`)).status, 204);
  assert.strictEqual((await call('GET', `/api/bookings/availability?venueId=${ctx.big.id}&date=${DAY}&slot=09:00`)).json.remaining, 37);
  assert.strictEqual((await call('DELETE', `/api/bookings/${ctx.bookB.id}`)).status, 404);
  assert.strictEqual((await call('DELETE', `/api/modules/${ctx.modB.id}`)).status, 204);
});

test('booking with no enrolled students is refused', async () => {
  const empty = (await call('POST', '/api/modules', { code: `E${tag}`, name: 'Empty' })).json;
  assert.strictEqual((await call('POST', '/api/bookings', { moduleId: empty.id, venueId: ctx.big.id, date: DAY, slot: '13:00' })).status, 409);
});

test('device session: only students with a seat, with seat numbers', async () => {
  const r = await call('GET', `/api/devices/${ctx.device.id}/session?date=${DAY}&slot=09:00`, undefined, dkey());
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.students.length, 3);
  assert.deepStrictEqual(r.json.students.map((s) => s.seatNumber), [1, 2, 3]);
  assert.strictEqual(r.json.students[0].moduleCode, ctx.modA.code);
  assert.strictEqual(r.json.students[0].onThisDevice, false); // enrolment still pending
  const none = await call('GET', `/api/devices/${ctx.device.id}/session?date=2031-12-25&slot=13:00`, undefined, dkey());
  assert.deepStrictEqual(none.json.students, []);
  const def = await call('GET', `/api/devices/${ctx.device.id}/session`, undefined, dkey());
  assert.strictEqual(def.status, 200); assert.ok(['09:00', '13:00'].includes(def.json.slot));
  assert.strictEqual((await call('GET', `/api/devices/${ctx.device.id}/session`)).status, 401);
  assert.strictEqual((await call('GET', `/api/devices/${ctx.device.id}/session?slot=10:00`, undefined, dkey())).status, 400);
});

test('student: deleting a student frees their seat', async () => {
  const before = (await call('GET', `/api/bookings/${ctx.bookA.id}`)).json.seats;
  await call('DELETE', `/api/students/${ctx.students[0].id}`);
  assert.strictEqual((await call('GET', `/api/bookings/${ctx.bookA.id}`)).json.seats, before - 1);
});

test('enrolment photo: device uploads, web reads, list never leaks bytes', async () => {
  const sid = ctx.students[1].id;
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
  const put = (headers) => fetch(`${BASE}/api/students/${sid}/enrollment-image`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', ...headers }, body: jpeg });
  assert.strictEqual((await put({})).status, 401);
  assert.strictEqual((await put(dkey())).status, 204);
  const wrongType = await fetch(`${BASE}/api/students/${sid}/enrollment-image`, { method: 'PUT', headers: { 'Content-Type': 'text/plain', ...dkey() }, body: 'hi' });
  assert.strictEqual(wrongType.status, 415);
  const got = await fetch(`${BASE}/api/students/${sid}/enrollment-image`);
  assert.strictEqual(got.status, 200);
  assert.strictEqual(got.headers.get('content-type'), 'image/jpeg');
  assert.deepStrictEqual(Buffer.from(await got.arrayBuffer()), jpeg);
  const s = (await call('GET', `/api/students/${sid}`)).json;
  assert.strictEqual(s.has_image, true);
  assert.ok(!('enrollment_image' in s));
  assert.strictEqual((await call('GET', `/api/students/${ctx.students[2].id}/enrollment-image`)).status, 404);
});
