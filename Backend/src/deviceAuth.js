// deviceAuth.js — middleware for routes the ESP32 calls.
// The device sends its id (in the URL as :id, or in the JSON body as deviceId) and its secret
// key in the X-Device-Key header. Any successfully authenticated call also refreshes last_seen,
// so a device that is polling or uploading counts as "online" without a separate heartbeat.
const pool = require('./db');
const { isId, keyMatches, handleDbError } = require('./http');

async function requireDevice(req, res, next) {
  const raw = req.params.id ?? req.body?.deviceId;
  if (raw === undefined || raw === null || raw === '') return res.status(400).json({ error: 'deviceId is required' });
  if (!isId(raw)) return res.status(400).json({ error: 'deviceId must be a positive integer' });
  try {
    const { rows } = await pool.query('SELECT id, venue_id, name, api_key FROM devices WHERE id = $1', [raw]);
    if (rows.length === 0) return res.status(404).json({ error: 'device not found' });
    if (!keyMatches(req.get('X-Device-Key'), rows[0].api_key)) {
      return res.status(401).json({ error: 'invalid or missing device key' });
    }
    req.device = rows[0];
    await pool.query('UPDATE devices SET last_seen = NOW() WHERE id = $1', [rows[0].id]);
    next();
  } catch (err) {
    handleDbError(res, err);
  }
}

module.exports = { requireDevice };
