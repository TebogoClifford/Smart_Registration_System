// auth.js — invigilator sign-in: password hashing, tokens, and the gate that protects the API.
//
// Terms:
//  * scrypt: a deliberately slow password-hashing function built into Node (no extra package).
//  * JWT (JSON Web Token): a signed string the browser sends as "Authorization: Bearer <token>".
//    The server can check the signature without storing sessions.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const prisma = require('./db');

const TOKEN_HOURS = parseInt(process.env.TOKEN_HOURS, 10) || 12;
const SECRET = process.env.JWT_SECRET || '';

// Sign-in is always on. The only way to run an open API is AUTH_DISABLED=true, set on purpose
// (the test suite in test/api.test.js does this). A missing JWT_SECRET no longer silently opens the API.
const authDisabled = process.env.AUTH_DISABLED === 'true';
const authEnabled = !authDisabled;
if (authEnabled && SECRET.length < 32) {
  throw new Error(SECRET
    ? 'JWT_SECRET is too short: use at least 32 random characters.'
    : 'JWT_SECRET is not set. Set it to 32+ random characters (or AUTH_DISABLED=true for local tests only).');
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

// A temporary password an administrator hands over (shown once). 12 characters from a set with
// no look-alikes (no 0/O, 1/l/I), always with a digit, so it is easy to read out or type.
const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
function temporaryPassword() {
  for (;;) {
    const pw = Array.from(crypto.randomBytes(12), (b) => TEMP_ALPHABET[b % TEMP_ALPHABET.length]).join('');
    if (/\d/.test(pw) && /[A-Za-z]/.test(pw)) return pw;
  }
}

// The account fields that are safe to send to the browser (never password_hash).
const USER_SELECT = {
  id: true, email: true, name: true, role: true, staff_number: true, phone: true,
  active: true, must_change_password: true, last_login_at: true, created_at: true,
};

// A real hash to compare against when the email does not exist, so "unknown email" and
// "wrong password" take about the same time (stops attackers listing which emails exist).
let dummyHash;
const getDummyHash = async () => (dummyHash ??= await hashPassword(crypto.randomBytes(8).toString('hex')));

// ---------- tokens ----------
const signToken = (user) =>
  jwt.sign({ sub: user.id, email: user.email, name: user.name, role: user.role }, SECRET, { algorithm: 'HS256', expiresIn: `${TOKEN_HOURS}h` });

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
  ['GET', /^\/devices\/\d+\/(config|pending-enrollments|roster|session)$/],
  ['POST', /^\/access-events$/],
  ['POST', /^\/access-events\/batch$/],
  ['PUT', /^\/students\/\d+\/enrollment$/],
  ['PUT', /^\/students\/\d+\/enrollment-image$/],
];
const PUBLIC_ROUTES = [
  ['POST', /^\/auth\/login$/],
  ['GET', /^\/auth\/status$/],
];
// The only routes open to someone who must first replace a password an administrator gave them.
const PASSWORD_CHANGE_ROUTES = [
  ['GET', /^\/auth\/me$/],
  ['PUT', /^\/auth\/password$/],
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
    // look the user up each time so deleting or disabling an account takes effect immediately
    const user = Number.isInteger(claims.sub) ? await prisma.users.findUnique({ where: { id: claims.sub }, select: USER_SELECT }) : null;
    if (!user) return res.status(401).json({ error: 'account no longer exists' });
    if (!user.active) return res.status(401).json({ error: 'this account has been disabled, contact an administrator' });
    req.user = user;
    if (req.user.must_change_password && !matches(PASSWORD_CHANGE_ROUTES, req)) {
      return res.status(403).json({ error: 'choose a new password first', code: 'PASSWORD_CHANGE_REQUIRED' });
    }
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError' || err.name === 'NotBeforeError') {
      return res.status(401).json({ error: 'session expired or invalid, please sign in again' });
    }
    next(err);
  }
}

// With sign-in off (AUTH_DISABLED=true, tests only) everyone counts as admin.
const isAdmin = (req) => !authEnabled || req.user?.role === 'admin';
function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  res.status(403).json({ error: 'only an administrator can do that' });
}

// Create the first account from ADMIN_EMAIL / ADMIN_PASSWORD when the users table is empty.
async function seedAdmin() {
  if (!authEnabled) {
    console.warn('⚠️  AUTH_DISABLED=true: sign-in is OFF and the API is open. Never use this on a real server.');
    return;
  }
  if ((await prisma.users.count()) > 0) return;
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || password.length < 8) {
    console.warn('⚠️  Sign-in is on but there are no accounts. Set ADMIN_EMAIL and ADMIN_PASSWORD (8+ chars) and restart.');
    return;
  }
  await prisma.users.upsert({
    where: { email },
    update: {},
    create: { email, name: 'Administrator', password_hash: await hashPassword(password), role: 'admin' },
  });
  console.log(`✅ Created first account: ${email}`);
}

module.exports = {
  authEnabled, isAdmin, requireAdmin, hashPassword, verifyPassword, getDummyHash, signToken,
  throttleKey, isThrottled, recordFailure, clearFailures, gate, seedAdmin, temporaryPassword, USER_SELECT,
};
