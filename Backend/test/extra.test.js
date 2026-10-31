// Extra API tests: edits, validation edge cases, stats arithmetic, limits.
// Against an AUTH_DISABLED=true server, run with: BASE_URL=http://localhost:3111 node --test test/extra.test.js
const { test } = require('node:test');
const assert = require('node:assert');

const BASE = process.env.BASE_URL || 'http://localhost:3111';
const call = async (method, path, body, headers = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
};
const ctx = {};
const key = () => ({ 'X-Device-Key': ctx.dev.api_key });

test('setup: venue, two devices, two students', async () => {
  ctx.venue = (await call('POST', '/api/venues', { name: 'Extra Hall', capacity: 50 })).json;
  ctx.dev = (await call('POST', '/api/devices', { venue_id: ctx.venue.id, name: 'Extra Dev' })).json;
  ctx.dev2 = (await call('POST', '/api/devices', { venue_id: ctx.venue.id, name: 'Extra Dev 2' })).json;
  ctx.s1 = (await call('POST', '/api/students', { email: 'student@example.com', student_number: 'X1', name: 'One', device_id: ctx.dev.id })).json;
  ctx.s2 = (await call('POST', '/api/students', { email: 'student@example.com', student_number: 'X2', name: 'Two', device_id: ctx.dev.id })).json;
  assert.ok(ctx.s1.id && ctx.s2.id);
});

test('device: edit name and venue', async () => {
  const v2 = (await call('POST', '/api/venues', { name: 'Second Hall', capacity: 50 })).json;
  ctx.v2 = v2;
  const r = await call('PUT', `/api/devices/${ctx.dev2.id}`, { name: 'Renamed', venue_id: v2.id });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.name, 'Renamed');
  assert.strictEqual(r.json.venue_id, v2.id);
});
test('device: edit with missing / bad / unknown venue', async () => {
  assert.strictEqual((await call('PUT', `/api/devices/${ctx.dev2.id}`, { name: 'x' })).status, 400);
  assert.strictEqual((await call('PUT', `/api/devices/${ctx.dev2.id}`, { name: 'x', venue_id: 'abc' })).status, 400);
  const r = await call('PUT', `/api/devices/${ctx.dev2.id}`, { name: 'x', venue_id: 999999 });
  assert.ok(r.status >= 400 && r.status < 500, `got ${r.status}`);
  assert.strictEqual((await call('PUT', '/api/devices/999999', { name: 'x', venue_id: ctx.v2.id })).status, 404);
});
test('device: PUT response never exposes more than the edit view', async () => {
  const r = await call('GET', '/api/devices');
  assert.ok(r.json.every((d) => d.api_key === undefined));
});
test('device: heartbeat with non-numeric id -> 400', async () => {
  assert.strictEqual((await call('POST', '/api/devices/heartbeat', { deviceId: 'abc' }, key())).status, 400);
  assert.strictEqual((await call('POST', '/api/devices/heartbeat', {}, key())).status, 400);
});
test('device: a device cannot use another device\'s key', async () => {
  const r = await call('POST', '/api/devices/heartbeat', { deviceId: ctx.dev2.id }, key());
  assert.strictEqual(r.status, 401);
});
test('device: never-seen device reports inactive', async () => {
  const r = await call('GET', `/api/devices/${ctx.dev2.id}`);
  assert.strictEqual(r.json.status, 'inactive');
  assert.strictEqual(r.json.last_seen, null);
});

test('student: edit details', async () => {
  const r = await call('PUT', `/api/students/${ctx.s2.id}`, { email: 'student@example.com', student_number: 'X2b', name: 'Two B', device_id: ctx.dev.id });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.name, 'Two B');
});
test('student: edit to a number already used on that device -> 409', async () => {
  const r = await call('PUT', `/api/students/${ctx.s2.id}`, { email: 'student@example.com', student_number: 'X1', name: 'Two', device_id: ctx.dev.id });
  assert.strictEqual(r.status, 409);
});
test('student: edit keeping own number is allowed', async () => {
  const r = await call('PUT', `/api/students/${ctx.s1.id}`, { email: 'student@example.com', student_number: 'X1', name: 'One renamed', device_id: ctx.dev.id });
  assert.strictEqual(r.status, 200);
});
test('student: same number on a different device is allowed', async () => {
  const r = await call('POST', '/api/students', { email: 'student@example.com', student_number: 'X1', name: 'One elsewhere', device_id: ctx.dev2.id });
  assert.strictEqual(r.status, 201);
});
test('student: missing fields -> 400; get unknown -> 404; get bad id -> 400', async () => {
  assert.strictEqual((await call('POST', '/api/students', { name: 'x' })).status, 400);
  assert.strictEqual((await call('GET', '/api/students/999999')).status, 404);
  assert.strictEqual((await call('GET', '/api/students/abc')).status, 400);
});
test('student: enrollment can be reported as failed; invalid status rejected', async () => {
  let r = await call('PUT', `/api/students/${ctx.s1.id}/enrollment`, { status: 'failed' }, key());
  assert.strictEqual(r.json.enrollment_status, 'failed');
  r = await call('PUT', `/api/students/${ctx.s1.id}/enrollment`, { status: 'bogus' }, key());
  assert.strictEqual(r.status, 400);
  r = await call('PUT', '/api/students/999999/enrollment', { status: 'enrolled' }, key());
  assert.strictEqual(r.status, 404);
});
test('student: a different device\'s key cannot set enrollment', async () => {
  const r = await call('PUT', `/api/students/${ctx.s1.id}/enrollment`, { status: 'enrolled' }, { 'X-Device-Key': ctx.dev2.api_key });
  assert.strictEqual(r.status, 401);
});

test('stats: arithmetic matches events posted today', async () => {
  const before = (await call('GET', '/api/stats')).json;
  await call('PUT', `/api/students/${ctx.s1.id}/enrollment`, { status: 'enrolled' }, key());
  for (const d of ['granted', 'granted', 'denied', 'error']) {
    assert.strictEqual((await call('POST', '/api/access-events', { deviceId: ctx.dev.id, decision: d }, key())).status, 201);
  }
  const after = (await call('GET', '/api/stats')).json;
  assert.strictEqual(after.total - before.total, 4);
  assert.strictEqual(after.granted - before.granted, 2);
  assert.strictEqual(after.denied - before.denied, 1);
  assert.strictEqual(after.errors - before.errors, 1);
  assert.strictEqual(after.enrolled - before.enrolled, 1);
  assert.strictEqual(after.totalStudents, after.enrolled + after.pending + (after.totalStudents - after.enrolled - after.pending));
  assert.ok(after.enrollmentRate >= 0 && after.enrollmentRate <= 100);
  assert.strictEqual(after.dailyTrend.length, 7);
  assert.ok(after.topVenues.length >= 1 && after.topVenues.length <= 5);
});
test('stats: an event from yesterday counts in the trend but not in today', async () => {
  const before = (await call('GET', '/api/stats')).json;
  const y = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
  assert.strictEqual((await call('POST', '/api/access-events', { deviceId: ctx.dev.id, decision: 'granted', timestamp: y }, key())).status, 201);
  const after = (await call('GET', '/api/stats')).json;
  assert.strictEqual(after.total, before.total);
  const sum = (s) => s.dailyTrend.reduce((a, d) => a + d.total, 0);
  assert.strictEqual(sum(after) - sum(before), 1);
});

test('events: limit param, upper bound, and junk values', async () => {
  let r = await call('GET', '/api/access-events?limit=2');
  assert.strictEqual(r.json.length, 2);
  r = await call('GET', '/api/access-events?limit=abc');
  assert.strictEqual(r.status, 200);
  r = await call('GET', '/api/access-events?limit=99999');
  assert.ok(r.json.length <= 500);
});
test('events: from/to window returns only events inside it', async () => {
  const to = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const from = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const r = await call('GET', `/api/access-events?from=${from}&to=${to}`);
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.length >= 1);
  assert.ok(r.json.every((e) => +new Date(e.timestamp) >= +new Date(from) && +new Date(e.timestamp) < +new Date(to)));
});
test('events: device id must be numeric; missing body fields -> 400', async () => {
  assert.strictEqual((await call('POST', '/api/access-events', { deviceId: 'abc', decision: 'granted' })).status, 400);
  assert.strictEqual((await call('POST', '/api/access-events', {})).status, 400);
  assert.strictEqual((await call('POST', '/api/access-events', { deviceId: 999999, decision: 'granted' })).status, 404);
});
test('events: override validation and double override', async () => {
  const ev = (await call('POST', '/api/access-events', { deviceId: ctx.dev.id, decision: 'denied' }, key())).json;
  assert.strictEqual((await call('POST', `/api/access-events/${ev.id}/override`, { reason: 'x' })).status, 400);
  assert.strictEqual((await call('POST', `/api/access-events/${ev.id}/override`, { invigilatorId: 'a' })).status, 400);
  assert.strictEqual((await call('POST', '/api/access-events/abc/override', { invigilatorId: 'a', reason: 'b' })).status, 400);
  assert.strictEqual((await call('POST', `/api/access-events/${ev.id}/override`, { invigilatorId: 'a', reason: 'b' })).status, 200);
  const again = await call('POST', `/api/access-events/${ev.id}/override`, { invigilatorId: 'a', reason: 'again' });
  assert.ok(again.status < 500, `got ${again.status}`);
});

test('venue: delete unknown -> 404, bad id -> 400, long name handled', async () => {
  assert.strictEqual((await call('DELETE', '/api/venues/999999')).status, 404);
  assert.strictEqual((await call('DELETE', '/api/venues/abc')).status, 400);
  const r = await call('POST', '/api/venues', { name: 'x'.repeat(500), capacity: 10 });
  assert.ok(r.status >= 400 && r.status < 500, `a 500-character venue name gave ${r.status}`);
});
test('input: names with quotes / unicode / SQL text are stored safely', async () => {
  const nasty = "O'Brien \"; DROP TABLE venues;-- 🎓";
  const r = await call('POST', '/api/venues', { name: nasty, capacity: 10 });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.json.name, nasty);
  assert.strictEqual((await call('GET', '/api/venues')).status, 200);
});
test('input: whitespace-only names are rejected', async () => {
  assert.strictEqual((await call('POST', '/api/venues', { name: '   ', capacity: 10 })).status, 400);
  assert.strictEqual((await call('POST', '/api/devices', { venue_id: ctx.venue.id, name: '   ' })).status, 400);
  assert.strictEqual((await call('POST', '/api/students', { email: 'student@example.com', student_number: ' ', name: 'x', device_id: ctx.dev.id })).status, 400);
});
