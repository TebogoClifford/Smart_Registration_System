const express = require('express');
const router = express.Router();
const pool = require('../db');

// POST /api/venues — create a venue
router.post('/', async (req, res) => {
  const { name } = (req.body ?? {});
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO venues (name) VALUES ($1) RETURNING *',
      [name]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// GET /api/venues — list all venues
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM venues ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// PUT /api/venues/:id — edit a venue's name
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name } = (req.body ?? {});
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const result = await pool.query(
      'UPDATE venues SET name = $1 WHERE id = $2 RETURNING *',
      [name, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'venue not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// DELETE /api/venues/:id — blocked if devices reference this venue
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const deviceCheck = await pool.query('SELECT id FROM devices WHERE venue_id = $1', [id]);
    if (deviceCheck.rows.length > 0) {
      return res.status(409).json({
        error: `Cannot delete venue: ${deviceCheck.rows.length} device(s) still assigned. Remove them first.`,
      });
    }
    const result = await pool.query('DELETE FROM venues WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'venue not found' });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  }
});

module.exports = router;