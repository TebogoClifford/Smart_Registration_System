const express = require('express');
const router = express.Router();
const pool = require('../db');
const auth = require('../auth');
const { handleDbError } = require('../http');
const { PHONE_RE } = require('./users');

// GET /api/auth/status — lets the web app know whether it must show the sign-in page
router.get('/status', (req, res) => res.json({ authRequired: auth.authEnabled }));

// POST /api/auth/login — email + password -> token
router.post('/login', async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  if (!auth.authEnabled) return res.status(400).json({ error: 'sign-in is not enabled on this server' });
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const key = auth.throttleKey(req, email);
  if (auth.isThrottled(key)) {
    return res.status(429).json({ error: 'too many failed attempts, try again in 15 minutes' });
  }
  try {
    const { rows } = await pool.query('SELECT id, active, password_hash FROM users WHERE email = $1', [email]);
    const user = rows[0];
    // always run one hash comparison, even for unknown emails (see getDummyHash)
    const ok = await auth.verifyPassword(password, user ? user.password_hash : await auth.getDummyHash());
    if (!user || !ok) {
      auth.recordFailure(key);
      return res.status(401).json({ error: 'incorrect email or password' });
    }
    auth.clearFailures(key);
    // told only after the right password, so this does not reveal which emails exist
    if (!user.active) return res.status(403).json({ error: 'this account has been disabled, contact an administrator' });
    const { rows: [safe] } = await pool.query(
      `UPDATE users SET last_login_at = NOW() WHERE id = $1 RETURNING ${auth.USER_COLS}`, [user.id]);
    res.json({ token: auth.signToken(safe), user: safe });
  } catch (err) {
    handleDbError(res, err);
  }
});

// GET /api/auth/me — who am I (also validates the stored token on page load)
router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'sign-in required' });
  res.json(req.user);
});

// PUT /api/auth/me — change my own name and phone (email, role and staff number are set by an administrator)
router.put('/me', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'sign-in required' });
  const name = req.body?.name === undefined ? undefined : String(req.body.name).trim();
  const phone = req.body?.phone === undefined ? undefined : String(req.body.phone ?? '').trim();
  if (name === undefined && phone === undefined) return res.status(400).json({ error: 'name or phone is required' });
  if (name !== undefined && !name) return res.status(400).json({ error: 'name cannot be empty' });
  if (phone && !PHONE_RE.test(phone)) return res.status(400).json({ error: 'phone number is not valid' });
  try {
    const { rows } = await pool.query(
      `UPDATE users SET name = COALESCE($1, name), phone = CASE WHEN $2::boolean THEN $3 ELSE phone END
       WHERE id = $4 RETURNING ${auth.USER_COLS}`,
      [name ?? null, phone !== undefined, phone || null, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    handleDbError(res, err);
  }
});

// PUT /api/auth/password — change my own password (needs the current one)
router.put('/password', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'sign-in required' });
  const { currentPassword, newPassword } = req.body ?? {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  if (String(newPassword).length < 8) return res.status(400).json({ error: 'new password must be at least 8 characters' });
  if (String(newPassword) === String(currentPassword)) return res.status(400).json({ error: 'the new password must be different from the current one' });
  try {
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!rows[0] || !(await auth.verifyPassword(String(currentPassword), rows[0].password_hash))) {
      return res.status(401).json({ error: 'current password is incorrect' });
    }
    const { rows: [me] } = await pool.query(
      `UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2 RETURNING ${auth.USER_COLS}`,
      [await auth.hashPassword(String(newPassword)), req.user.id]);
    res.json({ status: 'ok', user: me });
  } catch (err) {
    handleDbError(res, err);
  }
});

module.exports = router;
