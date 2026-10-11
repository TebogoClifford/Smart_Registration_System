// auth.js — invigilator sign-in: password hashing, tokens, and the gate that protects the API.
//
// Terms:
//  * scrypt: a deliberately slow password-hashing function built into Node (no extra package).
//  * JWT (JSON Web Token): a signed string the browser sends as "Authorization: Bearer <token>".
//    The server can check the signature without storing sessions.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('./db');

const TOKEN_HOURS = parseInt(process.env.TOKEN_HOURS, 10) || 12;
const SECRET = process.env.JWT_SECRET || '';

// Auth is on only when JWT_SECRET is set. Until then the API stays open (as before) and warns.
const authEnabled = SECRET.length > 0;
if (authEnabled && SECRET.length < 32) {
  throw new Error('JWT_SECRET is too short: use at least 32 random characters.');
}

// ---------- passwords ----------
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const scrypt = (password, salt) =>
  new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, (e, k) => (e ? reject(e) : resolve(k)))
  );

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [scheme, saltHex, keyHex] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// A real hash to compare against when the email does not exist, so "unknown email" and
// "wrong password" take about the same time (stops attackers listing which emails exist).
let dummyHash;
const getDummyHash = async () => (dummyHash ??= await hashPassword(crypto.randomBytes(8).toString('hex')));

// ---------- tokens ----------
const signToken = (user) =>
  jwt.sign({ sub: user.id, email: user.email, name: user.name }, SECRET, { algorithm: 'HS256', expiresIn: `${TOKEN_HOURS}h` });

// ---------- login throttle: 5 failures / 15 min per (ip, email) ----------
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
function throttleKey(req, email) { return `${req.ip}|${String(email).toLowerCase()}`; }
function isThrottled(key) {
  const e = attempts.get(key);
  if (!e) return false;
  if (Date.now() - e.first > WINDOW_MS) { attempts.delete(key); return false; }
  return e.count >= MAX_FAILS;
}
function recordFailure(key) {
  const e = attempts.get(key);
  if (!e || Date.now() - e.first > WINDOW_MS) attempts.set(key, { count: 1, first: Date.now() });
  else e.count += 1;
}
const clearFailures = (key) => attempts.delete(key);

// ---------- gate ----------
// Routes the ESP32 devices call. They do not carry a user token; they prove who they are with
// the device key (X-Device-Key), which each route checks itself.
const DEVICE_ROUTES = [
  ['POST', /^\/devices\/heartbeat$/],
  ['GET', /^\/devices\/\d+\/(config|pending-enrollments|roster)$/],
  ['POST', /^\/access-events$/],
  ['POST', /^\/access-events\/batch$/],
  ['PUT', /^\/students\/\d+\/enrollment$/],
];
const PUBLIC_ROUTES = [
  ['POST', /^\/auth\/login$/],
  ['GET', /^\/auth\/status$/],
];
const matches = (list, req) => list.some(([m, re]) => m === req.method && re.test(req.path));

// Mounted as app.use('/api', gate): every /api route needs a signed-in user unless listed above.
async function gate(req, res, next) {
  if (!authEnabled) return next();
  if (matches(PUBLIC_ROUTES, req) || matches(DEVICE_ROUTES, req)) return next();
  const header = req.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'sign-in required' });
  try {
    const claims = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
    // look the user up each time so deleting an account takes effect immediately
    const { rows } = await pool.query('SELECT id, email, name FROM users WHERE id = $1', [claims.sub]);
    if (rows.length === 0) return res.status(401).json({ error: 'account no longer exists' });
    req.user = rows[0];
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError' || err.name === 'NotBeforeError') {
      return res.status(401).json({ error: 'session expired or invalid, please sign in again' });
    }
    next(err);
  }
}

// Create the first account from ADMIN_EMAIL / ADMIN_PASSWORD when the users table is empty.
async function seedAdmin() {
  if (!authEnabled) {
    console.warn('⚠️  JWT_SECRET is not set: sign-in is DISABLED and the API is open. Set JWT_SECRET (32+ chars) to turn it on.');
    return;
  }
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
  if (rows[0].n > 0) return;
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || password.length < 8) {
    console.warn('⚠️  Sign-in is on but there are no accounts. Set ADMIN_EMAIL and ADMIN_PASSWORD (8+ chars) and restart.');
    return;
  }
  await pool.query('INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING',
    [email, 'Administrator', await hashPassword(password)]);
  console.log(`✅ Created first account: ${email}`);
}

module.exports = {
  authEnabled, hashPassword, verifyPassword, getDummyHash, signToken,
  throttleKey, isThrottled, recordFailure, clearFailures, gate, seedAdmin,
};
