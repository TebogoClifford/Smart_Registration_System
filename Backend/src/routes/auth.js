const express = require('express');
const router = express.Router();
const prisma = require('../db');
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
    const user = await prisma.users.findUnique({ where: { email }, select: { id: true, active: true, password_hash: true } });
    // always run one hash comparison, even for unknown emails (see getDummyHash)
    const ok = await auth.verifyPassword(password, user ? user.password_hash : await auth.getDummyHash());
    if (!user || !ok) {
      auth.recordFailure(key);
      return res.status(401).json({ error: 'incorrect email or password' });
    }
    auth.clearFailures(key);
    // told only after the right password, so this does not reveal which emails exist
    if (!user.active) return res.status(403).json({ error: 'this account has been disabled, contact an administrator' });
    const safe = await prisma.users.update({ where: { id: user.id }, data: { last_login_at: new Date() }, select: auth.USER_SELECT });
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
    const me = await prisma.users.update({
      where: { id: req.user.id },
      data: { name, ...(phone !== undefined && { phone: phone || null }) },
      select: auth.USER_SELECT,
    });
    res.json(me);
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
    const row = await prisma.users.findUnique({ where: { id: req.user.id }, select: { password_hash: true } });
    if (!row || !(await auth.verifyPassword(String(currentPassword), row.password_hash))) {
      return res.status(401).json({ error: 'current password is incorrect' });
    }
    const me = await prisma.users.update({
      where: { id: req.user.id },
      data: { password_hash: await auth.hashPassword(String(newPassword)), must_change_password: false },
      select: auth.USER_SELECT,
    });
    res.json({ status: 'ok', user: me });
  } catch (err) {
    handleDbError(res, err);
  }
});

module.exports = router;
