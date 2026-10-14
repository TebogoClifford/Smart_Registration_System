const express = require('express');
const router = express.Router();
const pool = require('../db');
const crypto = require('crypto');
const { validateIdParam, isId, handleDbError, keyMatches, LIVE_STATUS } = require('../http');

router.param('id', validateIdParam);



// POST /api/devices — register a device against a venue
router.post('/', async (req, res) => {
  const { venue_id, name } = (req.body ?? {});
  if (!venue_id || !name) {
    return res.status(400).json({ error: 'venue_id and name are required' });
  }
  if (!isId(venue_id)) return res.status(400).json({ error: 'venue_id must be a positive integer' });
  const api_key = crypto.randomBytes(32).toString('hex');
  try {
    const result = await pool.query(
      `INSERT INTO devices (venue_id, name, api_key, status)
       VALUES ($1, $2, $3, 'inactive') RETURNING *`,
      [venue_id, name, api_key]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    handleDbError(res, err);
  }
});

// GET /api/devices — list all devices
router.get('/', async (req, res) => {
  try {
    // api_key is a secret — only the single-device view (admin copy-to-firmware) returns it
    const result = await pool.query(
      `SELECT id, venue_id, name, ${LIVE_STATUS} AS status, last_seen FROM devices ORDER BY id`
    );
    res.json(result.rows);
  } catch (err) {
    handleDbError(res, err);
  }
});

// GET /api/devices/:id — single device (needed for detail page)
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, venue_id, name, api_key, ${LIVE_STATUS} AS status, last_seen FROM devices WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'device not found' });
    res.json(result.rows[0]);
  } catch (err) {
    handleDbError(res, err);
  }
});

// PUT /api/devices/:id — edit name/venue assignment
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, venue_id } = (req.body ?? {});
  if (!name || !venue_id) return res.status(400).json({ error: 'name and venue_id are required' });
  if (!isId(venue_id)) return res.status(400).json({ error: 'venue_id must be a positive integer' });
  try {
    const result = await pool.query(
      'UPDATE devices SET name = $1, venue_id = $2 WHERE id = $3 RETURNING *',
      [name, venue_id, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'device not found' });
    res.json(result.rows[0]);
  } catch (err) {
    handleDbError(res, err);
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
    // Access events are the audit trail, so a device that has reported events cannot be deleted.
    const eventCheck = await pool.query('SELECT 1 FROM access_events WHERE device_id = $1 LIMIT 1', [id]);
    if (eventCheck.rows.length > 0) {
      return res.status(409).json({
        error: 'Cannot delete device: it has recorded access events (audit history). Set it inactive instead.',
      });
    }
    const result = await pool.query('DELETE FROM devices WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'device not found' });
    res.status(204).send();
  } catch (err) {
    handleDbError(res, err);
  }
});

// POST /api/devices/heartbeat — device reports it is alive.
// Requires the device's api_key in the X-Device-Key header (design: shared secret on each request).
router.post('/heartbeat', async (req, res) => {
  const { deviceId } = (req.body ?? {});
  if (!deviceId) return res.status(400).json({ error: 'deviceId is required' });
  if (!isId(deviceId)) return res.status(400).json({ error: 'deviceId must be a positive integer' });
  try {
    const device = await pool.query('SELECT id, api_key FROM devices WHERE id = $1', [deviceId]);
    if (device.rows.length === 0) return res.status(404).json({ error: 'device not found' });
    if (!keyMatches(req.get('X-Device-Key'), device.rows[0].api_key)) {
      return res.status(401).json({ error: 'invalid or missing device key' });
    }
    await pool.query('UPDATE devices SET last_seen = NOW() WHERE id = $1', [deviceId]);
    res.json({ status: 'ok' });
  } catch (err) {
    handleDbError(res, err);
  }
});

module.exports = router;