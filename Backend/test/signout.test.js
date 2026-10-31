// Sessions end at 12:00 / 16:00: automatic sign-out and "session ended" — against an AUTH_DISABLED=true server,
// run with: BASE_URL=http://localhost:3111 node --test test/signout.test.js
// Uses yesterday's sessions (back-dated events, as an offline device uploads them), so the result does
// not depend on the time of day the tests run. Times are South African (EXAM_TIMEZONE default, UTC+2).
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
const tag = `SO${Date.now().toString(36).toUpperCase()}`;
const IT = 'National Diploma: Information Technology';
const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date(Date.now() - 86400000));
const at = (hhmm) => `${DAY}T${hhmm}:00+02:00`;
const ctx = {};
const dkey = () => ({ 'X-Device-Key': ctx.device.api_key });
const recognise = async (student, hhmm) => {
  const r = await call('POST', '/api/access-events', { deviceId: ctx.device.id, decision: 'granted', studentId: student.id, timestamp: at(hhmm) }, dkey());
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  return r.json.decision;
};

test('setup: hall, device, two students; morning exam for both, afternoon exam for the second', async () => {
  ctx.venue = (await call('POST', '/api/venues', { name: `Signout hall ${tag}`, capacity: 10 })).json;
  ctx.device = (await call('POST', '/api/devices', { venue_id: ctx.venue.id, name: `Door ${tag}` })).json;
  ctx.s = [];
  for (let i = 1; i <= 2; i++) {
    ctx.s.push((await call('POST', '/api/students', { email: 'student@example.com', student_number: `${tag}${i}`, name: `Signout ${i}`, device_id: ctx.device.id, course_name: IT })).json);
  }
  const morning = (await call('POST', '/api/modules', { code: `${tag}M`, name: 'Morning module' })).json;
  const afternoon = (await call('POST', '/api/modules', { code: `${tag}A`, name: 'Afternoon module' })).json;
  assert.strictEqual((await call('POST', `/api/modules/${morning.id}/students`, { studentIds: ctx.s.map((s) => s.id) })).status, 204);
  assert.strictEqual((await call('POST', `/api/modules/${afternoon.id}/students`, { studentIds: [ctx.s[1].id] })).status, 204);
  for (const [m, slot] of [[morning, '09:00'], [afternoon, '13:00']]) {
    const b = await call('POST', '/api/bookings', { moduleId: m.id, venueId: ctx.venue.id, date: DAY, slot });
    assert.strictEqual(b.status, 201, JSON.stringify(b.json));
  }
});

test('signed in once per session; after the session ends they are denied ("ended")', async () => {
  const [one, two] = ctx.s;
  assert.strictEqual(await recognise(one, '09:05'), 'granted');
  assert.strictEqual(await recognise(one, '11:00'), 'already');    // same session
  assert.strictEqual(await recognise(one, '12:30'), 'ended');      // morning over, no afternoon exam
  assert.strictEqual(await recognise(two, '09:10'), 'granted');
  assert.strictEqual(await recognise(two, '13:05'), 'granted');    // second exam: may sign in again
  assert.strictEqual(await recognise(two, '14:00'), 'already');
  assert.strictEqual(await recognise(two, '16:30'), 'ended');      // afternoon over
});

test('everyone let in is signed out automatically when their session ends', async () => {
  const ids = ctx.s.map((s) => s.id);
  const list = (await call('GET', `/api/access-events?from=${encodeURIComponent(at('00:00'))}&to=${encodeURIComponent(at('23:59'))}&limit=500`)).json
    .filter((e) => ids.includes(e.studentId) && e.decision === 'signed_out')
    .map((e) => `${e.studentId}@${new Date(e.timestamp).toISOString().slice(11, 16)}`).sort();
  const [one, two] = ids;
  // 12:00 / 16:00 South African time = 10:00 / 14:00 UTC; once per student per session, never twice
  assert.deepStrictEqual(list, [`${one}@10:00`, `${two}@10:00`, `${two}@14:00`].sort());
  const again = (await call('GET', `/api/access-events?from=${encodeURIComponent(at('00:00'))}&to=${encodeURIComponent(at('23:59'))}&limit=500`)).json
    .filter((e) => ids.includes(e.studentId) && e.decision === 'signed_out');
  assert.strictEqual(again.length, 3);
});

test('door device: an ended session reports ended and nobody inside', async () => {
  const s = (await call('GET', `/api/devices/${ctx.device.id}/session?date=${DAY}&slot=13:00`, undefined, dkey())).json;
  assert.strictEqual(s.ended, true);
  assert.strictEqual(s.endsAt, new Date(at('16:00')).toISOString());
  assert.deepStrictEqual(s.alreadyInside, []);
});

test('devices may report "ended", but never "signed_out"', async () => {
  const ok = await call('POST', '/api/access-events', { deviceId: ctx.device.id, decision: 'ended', studentId: ctx.s[0].id, timestamp: at('17:00') }, dkey());
  assert.strictEqual(ok.status, 201);
  const bad = await call('POST', '/api/access-events', { deviceId: ctx.device.id, decision: 'signed_out', studentId: ctx.s[0].id }, dkey());
  assert.strictEqual(bad.status, 400);
});
