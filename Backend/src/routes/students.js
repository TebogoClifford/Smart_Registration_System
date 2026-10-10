const express = require('express');
const router = express.Router();
const pool = require('../db');
const { validateIdParam, isId, handleDbError, keyMatches } = require('../http');

router.param('id', validateIdParam);

// POST /api/students — start enrollment (status defaults to 'pending')
router.post('/', async (req, res) => {
  const { student_number, name, device_id } = (req.body ?? {});
  if (!student_number || !name || !device_id) {
    return res
      .status(400)
      .json({ error: 'student_number, name, and device_id are required' });
  }
  if (!isId(device_id)) return res.status(400).json({ error: 'device_id must be a positive integer' });
  try {
    // Same student enrolled twice on the same device would give two embeddings for one person.
    const dup = await pool.query(
      'SELECT id FROM students WHERE student_number = $1 AND device_id = $2',
      [student_number, device_id]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: 'this student number is already registered on that device' });
    }
    const result = await pool.query(
      `INSERT INTO students (student_number, name, device_id, enrollment_status)
       VALUES ($1, $2, $3, 'pending') RETURNING *`,
      [student_number, name, device_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    handleDbError(res, err);
  }
});

// GET /api/students — list all students
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM students ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    handleDbError(res, err);
  }
});

// GET /api/students/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM students WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'student not found' });
    res.json(result.rows[0]);
  } catch (err) {
    handleDbError(res, err);
  }
});

// PUT /api/students/:id — edit name/number/device assignment
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { student_number, name, device_id } = (req.body ?? {});
  if (!student_number || !name || !device_id) {
    return res.status(400).json({ error: 'student_number, name, and device_id are required' });
  }
  if (!isId(device_id)) return res.status(400).json({ error: 'device_id must be a positive integer' });
  try {
    const dup = await pool.query(
      'SELECT id FROM students WHERE student_number = $1 AND device_id = $2 AND id <> $3',
      [student_number, device_id, id]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: 'this student number is already registered on that device' });
    }
    const result = await pool.query(
      'UPDATE students SET student_number = $1, name = $2, device_id = $3 WHERE id = $4 RETURNING *',
      [student_number, name, device_id, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'student not found' });
    res.json(result.rows[0]);
  } catch (err) {
    handleDbError(res, err);
  }
});

// PUT /api/students/:id/enrollment — the device reports the outcome of an enrollment capture
// (design: Student Enrollment, step 7-8). Needs the device's key in X-Device-Key.
router.put('/:id/enrollment', async (req, res) => {
  const { status } = (req.body ?? {});
  if (!['enrolled', 'failed'].includes(status)) {
    return res.status(400).json({ error: "status must be 'enrolled' or 'failed'" });
  }
  try {
    const found = await pool.query(
      `SELECT s.id, d.api_key FROM students s JOIN devices d ON d.id = s.device_id WHERE s.id = $1`,
      [req.params.id]
    );
    if (found.rows.length === 0) return res.status(404).json({ error: 'student not found' });
    if (!keyMatches(req.get('X-Device-Key'), found.rows[0].api_key)) {
      return res.status(401).json({ error: 'invalid or missing device key' });
    }
    const result = await pool.query(
      'UPDATE students SET enrollment_status = $1 WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    handleDbError(res, err);
  }
});

// DELETE /api/students/:id — access history is kept (audit trail): events lose the student link
// (access_events.student_id is nullable) instead of blocking the delete or being removed.
router.delete('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE access_events SET student_id = NULL WHERE student_id = $1', [req.params.id]);
    const result = await client.query('DELETE FROM students WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'student not found' });
    }
    await client.query('COMMIT');
    res.status(204).send();
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    handleDbError(res, err);
  } finally {
    client.release();
  }
});

module.exports = router;