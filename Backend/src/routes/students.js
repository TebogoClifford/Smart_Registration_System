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

module.exports = router;