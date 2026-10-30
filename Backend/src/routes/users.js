// /api/users — accounts. Roles: 'admin' (manages accounts, venues, devices) and 'invigilator' (enrolment and exam bookings).
// Only administrators may use this router.
//
// Every account has an email (the sign-in name), a password and a full name; staff number and phone
// are optional. A password an administrator sets or generates is temporary: the person must choose
// their own at the next sign-in (must_change_password), unless the administrator unticks that.
const express = require('express');
const router = express.Router();
const pool = require('../db');
const auth = require('../auth');
const { validateIdParam, handleDbError } = require('../http');

const ROLES = ['admin', 'invigilator'];
const COLS = auth.USER_COLS;
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
  if (err.code !== '23505') return false;
  const what = /staff_number/.test(err.constraint || err.detail || '') ? 'staff number' : 'email';
  res.status(409).json({ error: `an account with that ${what} already exists` });
  return true;
};

// Never leave the system without an active administrator.
async function otherActiveAdmins(id) {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND active AND id <> $1", [id]);
  return rows[0].n;
}

router.param('id', validateIdParam);
router.use(auth.requireAdmin);

// GET /api/users — never returns password hashes
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT ${COLS} FROM users ORDER BY role, name`);
    res.json(rows);
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
    const { rows } = await pool.query(
      `INSERT INTO users (email, name, password_hash, role, staff_number, phone, must_change_password)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLS}`,
      [email, name, await auth.hashPassword(password), role, d.staff_number ?? null, d.phone ?? null, mustChange]
    );
    res.status(201).json(given ? rows[0] : { ...rows[0], temporaryPassword: password });
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
      const cur = await pool.query('SELECT role FROM users WHERE id = $1', [id]);
      if (cur.rows[0]?.role === 'admin' && (await otherActiveAdmins(id)) === 0) {
        return res.status(409).json({ error: 'there must be at least one active administrator' });
      }
    }
    const hash = password === undefined ? null : await auth.hashPassword(password);
    const mustChange = password === undefined ? null : b.mustChangePassword !== false;
    const { rows } = await pool.query(
      `UPDATE users SET
         name = COALESCE($2, name), email = COALESCE($3, email), password_hash = COALESCE($4, password_hash),
         role = COALESCE($5, role), active = COALESCE($6, active),
         staff_number = CASE WHEN $7::boolean THEN $8 ELSE staff_number END,
         phone = CASE WHEN $9::boolean THEN $10 ELSE phone END,
         must_change_password = COALESCE($11, must_change_password)
       WHERE id = $1 RETURNING ${COLS}`,
      [id, name ?? null, email ?? null, hash, role ?? null, active ?? null,
        d.staff_number !== undefined, d.staff_number ?? null, d.phone !== undefined, d.phone ?? null, mustChange]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'account not found' });
    res.json(rows[0]);
  } catch (err) {
    if (!duplicate(err, res)) handleDbError(res, err);
  }
});

// POST /api/users/:id/reset-password — generate a temporary password, returned once.
// The person must choose their own at the next sign-in.
router.post('/:id/reset-password', async (req, res) => {
  const password = auth.temporaryPassword();
  try {
    const { rows } = await pool.query(
      `UPDATE users SET password_hash = $2, must_change_password = TRUE WHERE id = $1 RETURNING ${COLS}`,
      [req.params.id, await auth.hashPassword(password)]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'account not found' });
    res.json({ ...rows[0], temporaryPassword: password });
  } catch (err) { handleDbError(res, err); }
});

// DELETE /api/users/:id — cannot delete yourself or the last active administrator
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (req.user && req.user.id === id) return res.status(409).json({ error: 'you cannot delete your own account' });
  try {
    const cur = await pool.query('SELECT role FROM users WHERE id = $1', [id]);
    if (cur.rows.length === 0) return res.status(404).json({ error: 'account not found' });
    if (cur.rows[0].role === 'admin' && (await otherActiveAdmins(id)) === 0) {
      return res.status(409).json({ error: 'cannot delete the last active administrator' });
    }
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.status(204).send();
  } catch (err) { handleDbError(res, err); }
});

module.exports = router;
module.exports.PHONE_RE = PHONE_RE;
