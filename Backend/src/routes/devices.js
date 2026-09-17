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

module.exports = router;