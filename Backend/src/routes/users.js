// /api/users — accounts. Roles: 'admin' (manages accounts, venues, devices) and 'invigilator' (enrolment and exam bookings).
// Only administrators may use this router.
const express = require('express');
const router = express.Router();
const pool = require('../db');
const auth = require('../auth');
const { validateIdParam, handleDbError } = require('../http');

router.param('id', validateIdParam);
router.use(auth.requireAdmin);

const ROLES = ['admin', 'invigilator'];
const COLS = 'id, email, name, role, created_at';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /api/users — never returns password hashes
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT ${COLS} FROM users ORDER BY id`);
    res.json(rows);
  } catch (err) { handleDbError(res, err); }
});

// POST /api/users — create an account
router.post('/', async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const name = String(req.body?.name ?? '').trim();
  const password = String(req.body?.password ?? '');
  const role = req.body?.role ?? 'invigilator';
  if (!ROLES.includes(role)) return res.status(400).json({ error: `role must be one of ${ROLES.join(', ')}` });
  if (!email || !name || !password) return res.status(400).json({ error: 'name, email and password are required' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'email is not valid' });
  if (password.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING ${COLS}`,
      [email, name, await auth.hashPassword(password), role]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'an account with that email already exists' });
    handleDbError(res, err);
  }
});

// PUT /api/users/:id — rename, and/or reset the password (no current password needed)
router.put('/:id', async (req, res) => {
  const name = req.body?.name === undefined ? undefined : String(req.body.name).trim();
  const password = req.body?.password === undefined ? undefined : String(req.body.password);
  const role = req.body?.role;
  if (name === undefined && password === undefined && role === undefined) return res.status(400).json({ error: 'name, password or role is required' });
  if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: `role must be one of ${ROLES.join(', ')}` });
  if (name !== undefined && !name) return res.status(400).json({ error: 'name cannot be empty' });
  if (password !== undefined && password.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
  try {
    const hash = password === undefined ? null : await auth.hashPassword(password);
    if (role === 'invigilator') { // never demote the last administrator
      const a = await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND id <> $1", [req.params.id]);
      if (a.rows[0].n === 0) return res.status(409).json({ error: 'there must be at least one administrator' });
    }
    const { rows } = await pool.query(
      `UPDATE users SET name = COALESCE($1, name), password_hash = COALESCE($2, password_hash), role = COALESCE($4, role)
       WHERE id = $3 RETURNING ${COLS}`,
      [name ?? null, hash, req.params.id, role ?? null]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'account not found' });
    res.json(rows[0]);
  } catch (err) { handleDbError(res, err); }
});

// DELETE /api/users/:id — cannot delete yourself or the last remaining account
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (req.user && req.user.id === id) return res.status(409).json({ error: 'you cannot delete your own account' });
  try {
    const admins = await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND id <> $1", [id]);
    if (admins.rows[0].n === 0) return res.status(409).json({ error: 'cannot delete the last administrator' });
    const { rows } = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'account not found' });
    res.status(204).send();
  } catch (err) { handleDbError(res, err); }
});

module.exports = router;
