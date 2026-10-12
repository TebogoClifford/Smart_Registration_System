const express = require('express');
const router = express.Router();
const pool = require('../db');
const { validateIdParam, handleDbError, LIVE_STATUS } = require('../http');
const auth = require('../auth');

// capacity: whole number of seats, 1..10000
const parseCapacity = (v) => (Number.isInteger(v) && v >= 1 && v <= 10000 ? v : null);

router.param('id', validateIdParam);

// POST /api/venues — create a venue
router.post('/', auth.requireAdmin, async (req, res) => {
  const { name } = (req.body ?? {});
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  const capacity = parseCapacity(req.body.capacity);
  if (capacity === null) return res.status(400).json({ error: 'capacity must be a whole number of seats between 1 and 10000' });
  try {
    const result = await pool.query(
      'INSERT INTO venues (name, capacity) VALUES ($1, $2) RETURNING *',
      [name, capacity]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    handleDbError(res, err);
  }
});

// GET /api/venues — list all venues
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM venues ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    handleDbError(res, err);
  }
});

// GET /api/venues/:id — single venue
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM venues WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'venue not found' });
    res.json(result.rows[0]);
  } catch (err) {
    handleDbError(res, err);
  }
});

// GET /api/venues/:id/devices — devices assigned to a venue (api_key omitted)
router.get('/:id/devices', async (req, res) => {
  try {
    const venue = await pool.query('SELECT id FROM venues WHERE id = $1', [req.params.id]);
    if (venue.rows.length === 0) return res.status(404).json({ error: 'venue not found' });
    const result = await pool.query(
      `SELECT id, venue_id, name, ${LIVE_STATUS} AS status, last_seen
       FROM devices WHERE venue_id = $1 ORDER BY id`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    handleDbError(res, err);
  }
});

// PUT /api/venues/:id — edit a venue's name and capacity
router.put('/:id', auth.requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name } = (req.body ?? {});
  if (!name) return res.status(400).json({ error: 'name is required' });
  const capacity = parseCapacity(req.body.capacity);
  if (capacity === null) return res.status(400).json({ error: 'capacity must be a whole number of seats between 1 and 10000' });
  try {
    // never shrink a hall below seats already reserved in any one session
    const used = await pool.query(
      `SELECT COALESCE(MAX(n), 0)::int AS most FROM (
         SELECT COUNT(*) AS n FROM seat_reservations WHERE venue_id = $1 GROUP BY exam_date, slot) t`, [id]);
    if (capacity < used.rows[0].most) {
      return res.status(409).json({ error: `Cannot reduce capacity to ${capacity}: ${used.rows[0].most} seats are already reserved in one session. Cancel or move a booking first.` });
    }
    const result = await pool.query(
      'UPDATE venues SET name = $1, capacity = $2 WHERE id = $3 RETURNING *',
      [name, capacity, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'venue not found' });
    res.json(result.rows[0]);
  } catch (err) {
    handleDbError(res, err);
  }
});

// DELETE /api/venues/:id — blocked if devices reference this venue
router.delete('/:id', auth.requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const deviceCheck = await pool.query('SELECT id FROM devices WHERE venue_id = $1', [id]);
    if (deviceCheck.rows.length > 0) {
      return res.status(409).json({
        error: `Cannot delete venue: ${deviceCheck.rows.length} device(s) still assigned. Remove them first.`,
      });
    }
    const booked = await pool.query('SELECT COUNT(*)::int AS n FROM exam_bookings WHERE venue_id = $1', [id]);
    if (booked.rows[0].n > 0) return res.status(409).json({ error: `Cannot delete venue: ${booked.rows[0].n} exam booking(s) use it. Cancel them first.` });
    const result = await pool.query('DELETE FROM venues WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'venue not found' });
    res.status(204).send();
  } catch (err) {
    handleDbError(res, err);
  }
});

module.exports = router;