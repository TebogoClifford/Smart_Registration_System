// /api/users — accounts for invigilators. One role: anyone signed in can manage accounts.
const express = require('express');
const router = express.Router();
const pool = require('../db');
const auth = require('../auth');
const { validateIdParam, handleDbError } = require('../http');

router.param('id', validateIdParam);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /api/users — never returns password hashes
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, email, name, created_at FROM users ORDER BY id');
    res.json(rows);
  } catch (err) { handleDbError(res, err); }
});

// POST /api/users — create an account
router.post('/', async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const name = String(req.body?.name ?? '').trim();
  const password = String(req.body?.password ?? '');
  if (!email || !name || !password) return res.status(400).json({ error: 'name, email and password are required' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'email is not valid' });
  if (password.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, name, created_at',
      [email, name, await auth.hashPassword(password)]
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
  if (name === undefined && password === undefined) return res.status(400).json({ error: 'name or password is required' });
  if (name !== undefined && !name) return res.status(400).json({ error: 'name cannot be empty' });
  if (password !== undefined && password.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
  try {
    const hash = password === undefined ? null : await auth.hashPassword(password);
    const { rows } = await pool.query(
      `UPDATE users SET name = COALESCE($1, name), password_hash = COALESCE($2, password_hash)
       WHERE id = $3 RETURNING id, email, name, created_at`,
      [name ?? null, hash, req.params.id]
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
    const count = await pool.query('SELECT COUNT(*)::int AS n FROM users');
    if (count.rows[0].n <= 1) return res.status(409).json({ error: 'cannot delete the last account' });
    const { rows } = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'account not found' });
    res.status(204).send();
  } catch (err) { handleDbError(res, err); }
});

module.exports = router;
