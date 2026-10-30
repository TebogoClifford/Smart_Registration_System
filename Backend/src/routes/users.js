// /api/users — accounts. Roles: 'admin' (manages accounts, venues, devices) and 'invigilator' (enrolment and exam bookings).
// Only administrators may use this router.
//
// Every account has an email (the sign-in name), a password and a full name; staff number and phone
// are optional. A password an administrator sets or generates is temporary: the person must choose
// their own at the next sign-in (must_change_password), unless the administrator unticks that.
const express = require('express');
const router = express.Router();
const prisma = require('../db');
const auth = require('../auth');
const { validateIdParam, handleDbError, pgCode, isNotFound } = require('../http');

const ROLES = ['admin', 'invigilator'];
const SELECT = auth.USER_SELECT;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9 ()-]{7,20}$/;
const STAFF_RE = /^[A-Za-z0-9/-]{1,30}$/;

// Read and check the optional account details. Returns { error } or the cleaned values
// (undefined = not sent, null = cleared).
function details(body) {
  const out = {};
  for (const k of ['staff_number', 'phone']) {
    if (body?.[k] !== undefined) out[k] = String(body[k] ?? '').trim() || null;
  }
  if (out.phone && !PHONE_RE.test(out.phone)) return { error: 'phone number is not valid' };
  if (out.staff_number && !STAFF_RE.test(out.staff_number)) return { error: 'staff number may use letters, digits, / and - (max 30)' };
  return out;
}

const duplicate = (err, res) => {
  if (pgCode(err) !== '23505') return false;
  const what = /staff_number/.test(JSON.stringify(err.meta ?? {}) + (err.message ?? '')) ? 'staff number' : 'email';
  res.status(409).json({ error: `an account with that ${what} already exists` });
  return true;
};

// Never leave the system without an active administrator.
const otherActiveAdmins = (id) => prisma.users.count({ where: { role: 'admin', active: true, id: { not: id } } });

router.param('id', validateIdParam);
router.use(auth.requireAdmin);

// GET /api/users — never returns password hashes
router.get('/', async (req, res) => {
  try {
    res.json(await prisma.users.findMany({ select: SELECT, orderBy: [{ role: 'asc' }, { name: 'asc' }] }));
  } catch (err) { handleDbError(res, err); }
});

// POST /api/users — create an account. Leave password out to have one generated; it is returned
// once as temporaryPassword and never stored in readable form.
router.post('/', async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const name = String(req.body?.name ?? '').trim();
  const role = req.body?.role ?? 'invigilator';
  const given = req.body?.password ? String(req.body.password) : '';
  const mustChange = req.body?.mustChangePassword !== false;
  const d = details(req.body);
  if (d.error) return res.status(400).json({ error: d.error });
  if (!ROLES.includes(role)) return res.status(400).json({ error: `role must be one of ${ROLES.join(', ')}` });
  if (!email || !name) return res.status(400).json({ error: 'name and email are required' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'email is not valid' });
  if (given && given.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
  const password = given || auth.temporaryPassword();
  try {
    const user = await prisma.users.create({
      data: {
        email, name, role, password_hash: await auth.hashPassword(password),
        staff_number: d.staff_number ?? null, phone: d.phone ?? null, must_change_password: mustChange,
      },
      select: SELECT,
    });
    res.status(201).json(given ? user : { ...user, temporaryPassword: password });
  } catch (err) {
    if (!duplicate(err, res)) handleDbError(res, err);
  }
});

// PUT /api/users/:id — change details, role or active; and/or set a password (no current password needed)
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body ?? {};
  const name = b.name === undefined ? undefined : String(b.name).trim();
  const email = b.email === undefined ? undefined : String(b.email).trim().toLowerCase();
  const password = b.password === undefined ? undefined : String(b.password);
  const { role, active } = b;
  const d = details(b);
  if (d.error) return res.status(400).json({ error: d.error });
  const fields = [name, email, password, role, active, d.staff_number, d.phone];
  if (fields.every((v) => v === undefined)) return res.status(400).json({ error: 'nothing to change' });
  if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: `role must be one of ${ROLES.join(', ')}` });
  if (active !== undefined && typeof active !== 'boolean') return res.status(400).json({ error: 'active must be true or false' });
  if (name !== undefined && !name) return res.status(400).json({ error: 'name cannot be empty' });
  if (email !== undefined && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'email is not valid' });
  if (password !== undefined && password.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
  if (active === false && req.user && req.user.id === id) return res.status(409).json({ error: 'you cannot disable your own account' });
  try {
    if (role === 'invigilator' || active === false) {
      const cur = await prisma.users.findUnique({ where: { id }, select: { role: true } });
      if (cur?.role === 'admin' && (await otherActiveAdmins(id)) === 0) {
        return res.status(409).json({ error: 'there must be at least one active administrator' });
      }
    }
    const data = { name, email, role, active, staff_number: d.staff_number, phone: d.phone }; // undefined = leave as is
    if (password !== undefined) {
      data.password_hash = await auth.hashPassword(password);
      data.must_change_password = b.mustChangePassword !== false;
    }
    res.json(await prisma.users.update({ where: { id }, data, select: SELECT }));
  } catch (err) {
    if (isNotFound(err)) return res.status(404).json({ error: 'account not found' });
    if (!duplicate(err, res)) handleDbError(res, err);
  }
});

// POST /api/users/:id/reset-password — generate a temporary password, returned once.
// The person must choose their own at the next sign-in.
router.post('/:id/reset-password', async (req, res) => {
  const password = auth.temporaryPassword();
  try {
    const user = await prisma.users.update({
      where: { id: Number(req.params.id) },
      data: { password_hash: await auth.hashPassword(password), must_change_password: true },
      select: SELECT,
    });
    res.json({ ...user, temporaryPassword: password });
  } catch (err) {
    if (isNotFound(err)) return res.status(404).json({ error: 'account not found' });
    handleDbError(res, err);
  }
});

// DELETE /api/users/:id — cannot delete yourself or the last active administrator
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (req.user && req.user.id === id) return res.status(409).json({ error: 'you cannot delete your own account' });
  try {
    const cur = await prisma.users.findUnique({ where: { id }, select: { role: true } });
    if (!cur) return res.status(404).json({ error: 'account not found' });
    if (cur.role === 'admin' && (await otherActiveAdmins(id)) === 0) {
      return res.status(409).json({ error: 'cannot delete the last active administrator' });
    }
    await prisma.users.delete({ where: { id } });
    res.status(204).send();
  } catch (err) { handleDbError(res, err); }
});

module.exports = router;
module.exports.PHONE_RE = PHONE_RE;
