// deviceAuth.js — middleware for routes the ESP32 calls.
// The device sends its id (in the URL as :id, or in the JSON body as deviceId) and its secret
// key in the X-Device-Key header. Any successfully authenticated call also refreshes last_seen,
// so a device that is polling or uploading counts as "online" without a separate heartbeat.
const prisma = require('./db');
const { isId, keyMatches, handleDbError } = require('./http');

async function requireDevice(req, res, next) {
  const raw = req.params.id ?? req.body?.deviceId;
  if (raw === undefined || raw === null || raw === '') return res.status(400).json({ error: 'deviceId is required' });
  if (!isId(raw)) return res.status(400).json({ error: 'deviceId must be a positive integer' });
  try {
    const device = await prisma.devices.findUnique({
      where: { id: Number(raw) },
      select: { id: true, venue_id: true, name: true, api_key: true },
    });
    if (!device) return res.status(404).json({ error: 'device not found' });
    if (!keyMatches(req.get('X-Device-Key'), device.api_key)) {
      return res.status(401).json({ error: 'invalid or missing device key' });
    }
    req.device = device;
    await prisma.devices.update({ where: { id: device.id }, data: { last_seen: new Date() } });
    next();
  } catch (err) {
    handleDbError(res, err);
  }
}

module.exports = { requireDevice };
