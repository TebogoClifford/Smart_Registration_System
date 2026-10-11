// Sign-in and roles — needs a server started WITH sign-in:
//   JWT_SECRET=<32+ chars> ADMIN_EMAIL=admin@test.local ADMIN_PASSWORD=adminpass1 PORT=3112 node src/server.js
//   AUTH_BASE_URL=http://localhost:3112 node --test test/auth.test.js
const { test } = require('node:test');
const assert = require('node:assert');

const BASE = process.env.AUTH_BASE_URL;
const skip = BASE ? false : 'AUTH_BASE_URL not set';
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
const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const ctx = {};
const tag = Date.now().toString(36);

test('status says sign-in is required', { skip }, async () => {
  assert.deepStrictEqual((await call('GET', '/api/auth/status')).json, { authRequired: true });
});

test('API is closed without a token; /health and device routes are not', { skip }, async () => {
  assert.strictEqual((await call('GET', '/api/venues')).status, 401);
  assert.strictEqual((await call('GET', '/api/students')).status, 401);
  assert.strictEqual((await call('GET', '/api/venues', undefined, bearer('garbage'))).status, 401);
  assert.strictEqual((await call('GET', '/health')).status, 200);
  // device routes get past the sign-in gate and reach their own device check (here: unknown device)
  const r = await call('GET', '/api/devices/999999/config');
  assert.notStrictEqual(r.json.error, 'sign-in required');
  assert.match(r.json.error, /device/i);
});

test('login: wrong password and unknown email look identical', { skip }, async () => {
  const a = await call('POST', '/api/auth/login', { email: 'admin@test.local', password: 'nope-nope' });
  const b = await call('POST', '/api/auth/login', { email: 'nobody@test.local', password: 'nope-nope' });
  assert.strictEqual(a.status, 401); assert.strictEqual(b.status, 401);
  assert.strictEqual(a.json.error, b.json.error);
  assert.strictEqual((await call('POST', '/api/auth/login', { email: 'admin@test.local' })).status, 400);
});

test('login as the seeded administrator', { skip }, async () => {
  const r = await call('POST', '/api/auth/login', { email: 'Admin@Test.local', password: 'adminpass1' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.user.role, 'admin');
  assert.ok(!JSON.stringify(r.json).includes('password'));
  ctx.admin = r.json.token;
  const me = await call('GET', '/api/auth/me', undefined, bearer(ctx.admin));
  assert.strictEqual(me.json.email, 'admin@test.local');
});

test('admin creates an invigilator; invigilator can sign in', { skip }, async () => {
  const mk = await call('POST', '/api/users', { email: `inv${tag}@test.local`, name: 'Inv Igilator', password: 'invpass12' }, bearer(ctx.admin));
  assert.strictEqual(mk.status, 201);
  assert.strictEqual(mk.json.role, 'invigilator');
  assert.ok(!('password_hash' in mk.json));
  assert.strictEqual((await call('POST', '/api/users', { email: `inv${tag}@test.local`, name: 'Dup', password: 'invpass12' }, bearer(ctx.admin))).status, 409);
  assert.strictEqual((await call('POST', '/api/users', { email: 'bad', name: 'x', password: 'invpass12' }, bearer(ctx.admin))).status, 400);
  assert.strictEqual((await call('POST', '/api/users', { email: `x${tag}@test.local`, name: 'x', password: 'short' }, bearer(ctx.admin))).status, 400);
  assert.strictEqual((await call('POST', '/api/users', { email: `y${tag}@test.local`, name: 'x', password: 'invpass12', role: 'god' }, bearer(ctx.admin))).status, 400);
  const login = await call('POST', '/api/auth/login', { email: `inv${tag}@test.local`, password: 'invpass12' });
  assert.strictEqual(login.status, 200);
  ctx.inv = login.json.token; ctx.invId = mk.json.id;
});

test('invigilator: may run enrolment and bookings, may not manage venues, devices or accounts', { skip }, async () => {
  assert.strictEqual((await call('GET', '/api/venues', undefined, bearer(ctx.inv))).status, 200);
  assert.strictEqual((await call('GET', '/api/students', undefined, bearer(ctx.inv))).status, 200);
  assert.strictEqual((await call('POST', '/api/modules', { code: `M${tag}`, name: 'Mod' }, bearer(ctx.inv))).status, 201);
  assert.strictEqual((await call('POST', '/api/venues', { name: 'Nope', capacity: 10 }, bearer(ctx.inv))).status, 403);
  assert.strictEqual((await call('POST', '/api/devices', { venue_id: 1, name: 'Nope' }, bearer(ctx.inv))).status, 403);
  assert.strictEqual((await call('GET', '/api/users', undefined, bearer(ctx.inv))).status, 403);
  assert.strictEqual((await call('POST', '/api/users', { email: 'z@test.local', name: 'z', password: 'zzzzzzzz' }, bearer(ctx.inv))).status, 403);
});

test('device key is shown to administrators only', { skip }, async () => {
  const v = (await call('POST', '/api/venues', { name: `V${tag}`, capacity: 10 }, bearer(ctx.admin))).json;
  const d = (await call('POST', '/api/devices', { venue_id: v.id, name: `D${tag}` }, bearer(ctx.admin))).json;
  assert.ok((await call('GET', `/api/devices/${d.id}`, undefined, bearer(ctx.admin))).json.api_key);
  assert.ok(!('api_key' in (await call('GET', `/api/devices/${d.id}`, undefined, bearer(ctx.inv))).json));
  // the device itself works with its key and no user token
  const hb = await call('POST', '/api/devices/heartbeat', { deviceId: d.id }, { 'X-Device-Key': d.api_key });
  assert.strictEqual(hb.status, 200);
  assert.strictEqual((await call('GET', `/api/devices/${d.id}/session`, undefined, { 'X-Device-Key': d.api_key })).status, 200);
});

test('change own password needs the current one', { skip }, async () => {
  assert.strictEqual((await call('PUT', '/api/auth/password', { currentPassword: 'wrongwrong', newPassword: 'newpass123' }, bearer(ctx.inv))).status, 401);
  assert.strictEqual((await call('PUT', '/api/auth/password', { currentPassword: 'invpass12', newPassword: 'short' }, bearer(ctx.inv))).status, 400);
  assert.strictEqual((await call('PUT', '/api/auth/password', { currentPassword: 'invpass12', newPassword: 'newpass123' }, bearer(ctx.inv))).status, 200);
  assert.strictEqual((await call('POST', '/api/auth/login', { email: `inv${tag}@test.local`, password: 'newpass123' })).status, 200);
  assert.strictEqual((await call('POST', '/api/auth/login', { email: `inv${tag}@test.local`, password: 'invpass12' })).status, 401);
});

test('last administrator cannot be deleted or demoted; deleting an account kills its token', { skip }, async () => {
  const me = (await call('GET', '/api/auth/me', undefined, bearer(ctx.admin))).json;
  assert.strictEqual((await call('DELETE', `/api/users/${me.id}`, undefined, bearer(ctx.admin))).status, 409);
  assert.strictEqual((await call('PUT', `/api/users/${me.id}`, { role: 'invigilator' }, bearer(ctx.admin))).status, 409);
  assert.strictEqual((await call('DELETE', `/api/users/${ctx.invId}`, undefined, bearer(ctx.admin))).status, 204);
  assert.strictEqual((await call('GET', '/api/venues', undefined, bearer(ctx.inv))).status, 401);
});

test('login is throttled after repeated failures', { skip }, async () => {
  let last;
  for (let i = 0; i < 7; i++) last = await call('POST', '/api/auth/login', { email: `thr${tag}@test.local`, password: 'wrongwrong' });
  assert.strictEqual(last.status, 429);
});
