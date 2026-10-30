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
  assert.ok(!JSON.stringify(r.json).includes('password_hash') && !JSON.stringify(r.json).includes('scrypt$'));
  ctx.admin = r.json.token;
  const me = await call('GET', '/api/auth/me', undefined, bearer(ctx.admin));
  assert.strictEqual(me.json.email, 'admin@test.local');
});

test('admin creates an invigilator; invigilator can sign in', { skip }, async () => {
  const mk = await call('POST', '/api/users', { email: `inv${tag}@test.local`, name: 'Inv Igilator', password: 'invpass12', mustChangePassword: false }, bearer(ctx.admin));
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

test('account details: staff number and phone are stored, checked and unique', { skip }, async () => {
  const mk = await call('POST', '/api/users', { email: `det${tag}@test.local`, name: 'Det Ail', staff_number: `S${tag}`, phone: '+27 82 555 0101', role: 'invigilator' }, bearer(ctx.admin));
  assert.strictEqual(mk.status, 201);
  assert.strictEqual(mk.json.staff_number, `S${tag}`);
  assert.strictEqual(mk.json.phone, '+27 82 555 0101');
  assert.strictEqual(mk.json.active, true);
  ctx.detId = mk.json.id;
  // no password given -> a temporary one comes back once, and the person must change it
  assert.match(mk.json.temporaryPassword, /^[A-Za-z0-9]{12}$/);
  assert.strictEqual(mk.json.must_change_password, true);
  ctx.detTemp = mk.json.temporaryPassword;
  assert.strictEqual((await call('POST', '/api/users', { email: `det2${tag}@test.local`, name: 'x', staff_number: `s${tag}` }, bearer(ctx.admin))).status, 409);
  assert.strictEqual((await call('POST', '/api/users', { email: `det3${tag}@test.local`, name: 'x', phone: 'call me' }, bearer(ctx.admin))).status, 400);
  const ed = await call('PUT', `/api/users/${ctx.detId}`, { phone: '', name: 'Det Edited' }, bearer(ctx.admin));
  assert.strictEqual(ed.status, 200);
  assert.strictEqual(ed.json.phone, null);
  assert.strictEqual(ed.json.name, 'Det Edited');
  const list = (await call('GET', '/api/users', undefined, bearer(ctx.admin))).json;
  assert.ok(list.every((u) => !('password_hash' in u)));
});

test('temporary password: must be replaced before anything else works', { skip }, async () => {
  const login = await call('POST', '/api/auth/login', { email: `det${tag}@test.local`, password: ctx.detTemp });
  assert.strictEqual(login.status, 200);
  assert.strictEqual(login.json.user.must_change_password, true);
  const t = login.json.token;
  const blocked = await call('GET', '/api/venues', undefined, bearer(t));
  assert.strictEqual(blocked.status, 403);
  assert.strictEqual(blocked.json.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.strictEqual((await call('GET', '/api/auth/me', undefined, bearer(t))).status, 200);
  assert.strictEqual((await call('PUT', '/api/auth/password', { currentPassword: ctx.detTemp, newPassword: ctx.detTemp }, bearer(t))).status, 400);
  const ch = await call('PUT', '/api/auth/password', { currentPassword: ctx.detTemp, newPassword: 'mine-now-123' }, bearer(t));
  assert.strictEqual(ch.status, 200);
  assert.strictEqual(ch.json.user.must_change_password, false);
  assert.strictEqual((await call('GET', '/api/venues', undefined, bearer(t))).status, 200);
  // own profile: name and phone yes; role cannot be changed this way
  const me = await call('PUT', '/api/auth/me', { name: 'Det Self', phone: '012 345 6789', role: 'admin' }, bearer(t));
  assert.strictEqual(me.status, 200);
  assert.strictEqual(me.json.name, 'Det Self');
  assert.strictEqual(me.json.role, 'invigilator');
  ctx.det = t;
});

test('admin reset gives a new temporary password; disabling blocks sign-in and live tokens', { skip }, async () => {
  const r = await call('POST', `/api/users/${ctx.detId}/reset-password`, undefined, bearer(ctx.admin));
  assert.strictEqual(r.status, 200);
  assert.match(r.json.temporaryPassword, /^[A-Za-z0-9]{12}$/);
  assert.strictEqual((await call('POST', '/api/auth/login', { email: `det${tag}@test.local`, password: 'mine-now-123' })).status, 401);
  assert.strictEqual((await call('POST', '/api/auth/login', { email: `det${tag}@test.local`, password: r.json.temporaryPassword })).status, 200);
  assert.strictEqual((await call('PUT', `/api/users/${ctx.detId}`, { active: false }, bearer(ctx.admin))).status, 200);
  assert.strictEqual((await call('GET', '/api/auth/me', undefined, bearer(ctx.det))).status, 401);
  assert.strictEqual((await call('POST', '/api/auth/login', { email: `det${tag}@test.local`, password: r.json.temporaryPassword })).status, 403);
  const me = (await call('GET', '/api/auth/me', undefined, bearer(ctx.admin))).json;
  assert.strictEqual((await call('PUT', `/api/users/${me.id}`, { active: false }, bearer(ctx.admin))).status, 409);
  assert.strictEqual((await call('DELETE', `/api/users/${ctx.detId}`, undefined, bearer(ctx.admin))).status, 204);
});

test('login is throttled after repeated failures', { skip }, async () => {
  let last;
  for (let i = 0; i < 7; i++) last = await call('POST', '/api/auth/login', { email: `thr${tag}@test.local`, password: 'wrongwrong' });
  assert.strictEqual(last.status, 429);
});
