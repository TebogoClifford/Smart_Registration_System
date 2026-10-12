// device-simulator.js — plays the part of an ESP32-CAM against the real backend, so the whole
// device flow can be tried before the hardware is connected.
//
//   BASE_URL=http://localhost:3000 DEVICE_ID=1 DEVICE_KEY=<key from the device page> node tools/device-simulator.js
//
// What it does, in the order the firmware should do it:
//   1 config → 2 heartbeat → 3 pending enrolments (uploads a photo and reports "enrolled")
//   → 4 exam-session list → 5 simulated door scans, uploaded as a batch → 6 re-upload (duplicates are ignored)
const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const ID = process.env.DEVICE_ID;
const KEY = process.env.DEVICE_KEY;
if (!ID || !KEY) { console.error('Set DEVICE_ID and DEVICE_KEY (copy the key from the device page in the web console).'); process.exit(1); }

const headers = { 'X-Device-Key': KEY };
const json = { ...headers, 'Content-Type': 'application/json' };
// a few bytes that look like the start of a JPEG; a real device sends the camera frame
const FAKE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);

async function call(method, path, { body, raw } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: raw ? { ...headers, 'Content-Type': 'image/jpeg' } : body ? json : headers,
    body: raw ?? (body ? JSON.stringify(body) : undefined),
    signal: AbortSignal.timeout(60000), // Render's free tier can take ~30 s to wake up
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* empty body */ }
  console.log(`  ${method} ${path} -> ${res.status}`);
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${data?.error ?? text}`);
  return data;
}

(async () => {
  console.log('1. config');
  const cfg = await call('GET', `/api/devices/${ID}/config`);
  console.log('  ', JSON.stringify(cfg));

  console.log('2. heartbeat');
  await call('POST', '/api/devices/heartbeat', { body: { deviceId: Number(ID) } });

  console.log('3. pending enrolments');
  const pending = await call('GET', `/api/devices/${ID}/pending-enrollments`);
  for (const s of pending) {
    console.log(`   capturing ${s.studentNumber} (${s.name})`);
    await call('PUT', `/api/students/${s.studentId}/enrollment-image`, { raw: FAKE_JPEG });
    await call('PUT', `/api/students/${s.studentId}/enrollment`, { body: { status: 'enrolled' } });
  }
  if (pending.length === 0) console.log('   nothing waiting');

  console.log('4. exam session (who may enter now)');
  const session = await call('GET', `/api/devices/${ID}/session`);
  console.log(`   ${session.date} ${session.slot}: ${session.students.length} seated student(s)`);

  console.log('5. door scans, uploaded as one batch');
  const stamp = Date.now().toString(36);
  const events = session.students.filter((s) => s.onThisDevice).slice(0, 3)
    .map((s, i) => ({ studentId: s.studentId, decision: 'granted', secondsAgo: 30 - i * 10, clientEventId: `sim-${stamp}-${i}` }));
  events.push({ decision: 'denied', secondsAgo: 5, clientEventId: `sim-${stamp}-x` }); // unknown face / no seat
  const first = await call('POST', '/api/access-events/batch', { body: { deviceId: Number(ID), events } });
  console.log('  ', JSON.stringify(first.results?.map((r) => r.status)));

  console.log('6. same batch again (a retry after a WiFi drop) must not create duplicates');
  const again = await call('POST', '/api/access-events/batch', { body: { deviceId: Number(ID), events } });
  console.log('  ', JSON.stringify(again.results?.map((r) => r.status)));
  console.log('Done.');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
