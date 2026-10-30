// API tests — start an open test server (AUTH_DISABLED=true PORT=3111 npm start), then run with: BASE_URL=http://localhost:3111 node --test test/api.test.js
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
const key = () => ({ 'X-Device-Key': ctx.device.api_key });

test('health check', async () => {
  const r = await call('GET', '/health');
  assert.strictEqual(r.status, 200);
});

// ---------- venues ----------
test('venue: create / list / edit', async () => {
  let r = await call('POST', '/api/venues', { name: 'Exam Hall A', capacity: 50 });
  assert.strictEqual(r.status, 201);
  ctx.venue = r.json;
  r = await call('GET', '/api/venues');
  assert.ok(r.json.some((v) => v.id === ctx.venue.id));
  r = await call('PUT', `/api/venues/${ctx.venue.id}`, { name: 'Exam Hall B', capacity: 50 });
  assert.strictEqual(r.json.name, 'Exam Hall B');
});
test('venue: missing name -> 400', async () => {
  assert.strictEqual((await call('POST', '/api/venues', {})).status, 400);
});
test('venue: non-numeric id -> 400/404, not 500', async () => {
  const r = await call('PUT', '/api/venues/abc', { name: 'x' });
  assert.ok([400, 404].includes(r.status), `got ${r.status}`);
});
test('venue: unknown id -> 404', async () => {
  assert.strictEqual((await call('PUT', '/api/venues/999999', { name: 'x', capacity: 10 })).status, 404);
});

// ---------- devices ----------
test('device: create against venue', async () => {
  const r = await call('POST', '/api/devices', { venue_id: ctx.venue.id, name: 'Entrance Cam 1' });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.json.api_key.length, 64);
  ctx.device = r.json;
});
test('device: non-existent venue -> 4xx, not 500', async () => {
  const r = await call('POST', '/api/devices', { venue_id: 999999, name: 'bad' });
  assert.ok(r.status >= 400 && r.status < 500, `got ${r.status}`);
});
test('device: list does not leak api_key', async () => {
  const r = await call('GET', '/api/devices');
  assert.ok(r.json.every((d) => d.api_key === undefined), 'api_key exposed to unauthenticated callers');
});
test('device: heartbeat updates last_seen', async () => {
  const r = await call('POST', '/api/devices/heartbeat', { deviceId: ctx.device.id }, key());
  assert.strictEqual(r.status, 200);
  const d = await call('GET', `/api/devices/${ctx.device.id}`);
  assert.ok(d.json.last_seen, 'last_seen not set');
});
test('device: heartbeat for unknown device -> 404', async () => {
  const r = await call('POST', '/api/devices/heartbeat', { deviceId: 999999 }, key());
  assert.strictEqual(r.status, 404);
});
test('device: heartbeat without / with wrong key -> 401', async () => {
  assert.strictEqual((await call('POST', '/api/devices/heartbeat', { deviceId: ctx.device.id })).status, 401);
  const bad = { 'X-Device-Key': 'x'.repeat(64) };
  assert.strictEqual((await call('POST', '/api/devices/heartbeat', { deviceId: ctx.device.id }, bad)).status, 401);
});
test('device: single-device view still returns api_key (admin copies it into firmware)', async () => {
  const r = await call('GET', `/api/devices/${ctx.device.id}`);
  assert.strictEqual(r.json.api_key, ctx.device.api_key);
});
test('device: heartbeat marks device active', async () => {
  const d = await call('GET', `/api/devices/${ctx.device.id}`);
  assert.strictEqual(d.json.status, 'active');
});

// ---------- students ----------
test('student: create pending', async () => {
  const r = await call('POST', '/api/students', { student_number: '220000001', name: 'Test Student', device_id: ctx.device.id });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.json.enrollment_status, 'pending');
  ctx.student = r.json;
});
test('student: duplicate student_number -> 409, not 500', async () => {
  const r = await call('POST', '/api/students', { student_number: '220000001', name: 'Dup', device_id: ctx.device.id });
  assert.strictEqual(r.status, 409, `got ${r.status}`);
});
test('student: non-existent device -> 4xx, not 500', async () => {
  const r = await call('POST', '/api/students', { student_number: '220000002', name: 'X', device_id: 999999 });
  assert.ok(r.status >= 400 && r.status < 500, `got ${r.status}`);
});
test('student: enrollment result needs the device key', async () => {
  const r = await call('PUT', `/api/students/${ctx.student.id}/enrollment`, { status: 'enrolled' });
  assert.strictEqual(r.status, 401);
});
test('student: device reports enrollment complete', async () => {
  const r = await call('PUT', `/api/students/${ctx.student.id}/enrollment`, { status: 'enrolled' }, key());
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.enrollment_status, 'enrolled');
});

// ---------- access events ----------
test('event: granted with student', async () => {
  const r = await call('POST', '/api/access-events', { deviceId: ctx.device.id, studentId: ctx.student.id, decision: 'granted' }, key());
  assert.strictEqual(r.status, 201);
  ctx.event = r.json;
});
test('event: denied with null student', async () => {
  const r = await call('POST', '/api/access-events', { deviceId: ctx.device.id, studentId: null, decision: 'denied' }, key());
  assert.strictEqual(r.status, 201);
});
test('event: no device key -> 401', async () => {
  const r = await call('POST', '/api/access-events', { deviceId: ctx.device.id, decision: 'granted' });
  assert.strictEqual(r.status, 401);
});
test('event: bad decision -> 400', async () => {
  assert.strictEqual((await call('POST', '/api/access-events', { deviceId: ctx.device.id, decision: 'maybe' }, key())).status, 400);
});
test('event: invalid timestamp -> 400, not 500', async () => {
  const r = await call('POST', '/api/access-events', { deviceId: ctx.device.id, decision: 'denied', timestamp: 'not-a-date' }, key());
  assert.strictEqual(r.status, 400, `got ${r.status}`);
});
test('event: unknown student -> 4xx, not 500', async () => {
  const r = await call('POST', '/api/access-events', { deviceId: ctx.device.id, studentId: 999999, decision: 'granted' }, key());
  assert.ok(r.status >= 400 && r.status < 500, `got ${r.status}`);
});
test('event: error decision is accepted (design: Error status)', async () => {
  const r = await call('POST', '/api/access-events', { deviceId: ctx.device.id, decision: 'error' }, key());
  assert.strictEqual(r.status, 201, `got ${r.status}`);
});
test('event: list is newest first', async () => {
  const r = await call('GET', '/api/access-events');
  assert.strictEqual(r.status, 200);
  const t = r.json.map((e) => +new Date(e.timestamp));
  assert.deepStrictEqual(t, [...t].sort((a, b) => b - a));
});
test('event: list supports from/to filter (dashboard date picker)', async () => {
  let r = await call('GET', '/api/access-events?from=2000-01-01T00:00:00Z&to=2000-01-02T00:00:00Z');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.length, 0);
  r = await call('GET', '/api/access-events?from=garbage');
  assert.strictEqual(r.status, 400);
});
test('event: override is recorded and visible on the event', async () => {
  let r = await call('POST', `/api/access-events/${ctx.event.id}/override`, { invigilatorId: 'inv1', reason: 'ID checked manually' });
  assert.strictEqual(r.status, 200);
  r = await call('GET', '/api/access-events');
  const e = r.json.find((x) => x.id === ctx.event.id);
  assert.ok(e.overridden, 'event does not override');
});
test('event: override unknown event -> 404', async () => {
  const r = await call('POST', '/api/access-events/999999/override', { invigilatorId: 'a', reason: 'b'});
  assert.strictEqual(r.status, 404);
});

// ---------- stats ----------
test('stats: counts today and errors', async () => {
  const r = await call('GET', '/api/stats');
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.total >= 3);
  assert.ok(r.json.errors >= 1, 'errors count never increments');
  assert.strictEqual(r.json.dailyTrend.length, 7);
});

// ---------- admin / security ----------
test('security: migration endpoints are not public GETs', async () => {
  const r = await call('GET', '/api/admin/migrate-overrides');
  assert.ok(r.status === 401 || r.status === 403 || r.status === 404, `got ${r.status}`);
});

test('http: malformed JSON body -> 400 JSON', async () => {
  const res = await fetch(BASE + '/api/venues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  assert.strictEqual(res.status, 400);
});
test('http: unknown route -> 404 JSON', async () => {
  const r = await call('GET', '/api/nope');
  assert.strictEqual(r.status, 404);
  assert.ok(r.json && r.json.error);
});
test('venue: GET one + its devices (used by api.js)', async () => {
  let r = await call('GET', `/api/venues/${ctx.venue.id}`);
  assert.strictEqual(r.status, 200);
  r = await call('GET', `/api/venues/${ctx.venue.id}/devices`);
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.every((d) => d.api_key === undefined));
  assert.strictEqual((await call('GET', '/api/venues/999999')).status, 404);
});

// ---------- delete rules ----------
test('delete: venue blocked while device assigned (409)', async () => {
  assert.strictEqual((await call('DELETE', `/api/venues/${ctx.venue.id}`)).status, 409);
});
test('delete: device blocked while student enrolled (409)', async () => {
  assert.strictEqual((await call('DELETE', `/api/devices/${ctx.device.id}`)).status, 409);
});
test('delete: student removed, access history kept with null student', async () => {
  assert.strictEqual((await call('DELETE', `/api/students/${ctx.student.id}`)).status, 204);
  const r = await call('GET', '/api/access-events');
  const e = r.json.find((x) => x.id === ctx.event.id);
  assert.ok(e && e.studentId === null);
  assert.strictEqual((await call('DELETE', `/api/students/${ctx.student.id}`)).status, 404);
});
test('delete: device with recorded events is blocked (409); empty device + venue can go', async () => {
  assert.strictEqual((await call('DELETE', `/api/devices/${ctx.device.id}`)).status, 409);
  const v = (await call('POST', '/api/venues', { name: 'Temp', capacity: 50 })).json;
  const d = (await call('POST', '/api/devices', { venue_id: v.id, name: 'Temp dev' })).json;
  assert.strictEqual((await call('DELETE', `/api/devices/${d.id}`)).status, 204);
  assert.strictEqual((await call('DELETE', `/api/venues/${v.id}`)).status, 204);
});
