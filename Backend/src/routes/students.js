const express = require('express');
const router = express.Router();
const pool = require('../db');

// POST /api/students — start enrollment (status defaults to 'pending')
router.post('/', async (req, res) => {
  const { student_number, name, device_id } = req.body;
  if (!student_number || !name || !device_id) {
    return res
      .status(400)
      .json({ error: 'student_number, name, and device_id are required' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO students (student_number, name, device_id, enrollment_status)
       VALUES ($1, $2, $3, 'pending') RETURNING *`,
      [student_number, name, device_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// GET /api/students — list all students
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM students ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// GET /api/students/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM students WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'student not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// PUT /api/students/:id — edit name/number/device assignment
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { student_number, name, device_id } = req.body;
  if (!student_number || !name || !device_id) {
    return res.status(400).json({ error: 'student_number, name, and device_id are required' });
  }
  try {
    const result = await pool.query(
      'UPDATE students SET student_number = $1, name = $2, device_id = $3 WHERE id = $4 RETURNING *',
      [student_number, name, device_id, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'student not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// DELETE /api/students/:id — no dependents to block on (access_events.student_id is nullable)
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM students WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'student not found' });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  }
});

module.exports = router;