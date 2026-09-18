const express = require('express');
const router = express.Router();
const pool = require('../db');
const crypto = require('crypto');

// POST /api/devices — register a device against a venue
router.post('/', async (req, res) => {
  const { venue_id, name } = req.body;
  if (!venue_id || !name) {
    return res.status(400).json({ error: 'venue_id and name are required' });
  }
  const api_key = crypto.randomBytes(32).toString('hex');
  try {
    const result = await pool.query(
      `INSERT INTO devices (venue_id, name, api_key, status)
       VALUES ($1, $2, $3, 'inactive') RETURNING *`,
      [venue_id, name, api_key]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// GET /api/devices — list all devices
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM devices ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// GET /api/devices/:id — single device (needed for detail page)
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM devices WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'device not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// PUT /api/devices/:id — edit name/venue assignment
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, venue_id } = req.body;
  if (!name || !venue_id) return res.status(400).json({ error: 'name and venue_id are required' });
  try {
    const result = await pool.query(
      'UPDATE devices SET name = $1, venue_id = $2 WHERE id = $3 RETURNING *',
      [name, venue_id, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'device not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// DELETE /api/devices/:id — blocked if students are enrolled on this device
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const studentCheck = await pool.query('SELECT id FROM students WHERE device_id = $1', [id]);
    if (studentCheck.rows.length > 0) {
      return res.status(409).json({
        error: `Cannot delete device: ${studentCheck.rows.length} student(s) still enrolled. Remove them first.`,
      });
    }
    const result = await pool.query('DELETE FROM devices WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'device not found' });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  }
});

module.exports = router;