// http.js — small shared helpers for request validation and DB error mapping
const crypto = require('crypto');

// router.param handler: reject non-numeric :id before it reaches Postgres
// (otherwise Postgres throws "invalid input syntax for type integer" -> 500).
function validateIdParam(req, res, next, value) {
  if (!/^\d+$/.test(String(value)) || Number(value) > 2147483647) {
    return res.status(400).json({ error: 'id must be a positive integer' });
  }
  next();
}

// True if v is a positive integer (number or numeric string).
const isId = (v) => /^\d+$/.test(String(v)) && Number(v) > 0 && Number(v) <= 2147483647;

// Map known Postgres errors to client errors; anything else is a real 500.
function handleDbError(res, err) {
  if (err.code === '23503') { // foreign_key_violation
    return res.status(400).json({ error: 'a referenced venue, device or student does not exist' });
  }
  if (err.code === '23505') { // unique_violation
    return res.status(409).json({ error: 'a record with those details already exists' });
  }
  if (err.code === '22P02' || err.code === '22007' || err.code === '22008') { // bad input syntax / date
    return res.status(400).json({ error: 'one or more fields have an invalid format' });
  }
  console.error(err);
  return res.status(500).json({ error: 'internal server error' });
}

// Constant-time comparison of a presented device key against the stored one.
function keyMatches(presented, stored) {
  if (!presented || !stored) return false;
  const a = Buffer.from(String(presented));
  const b = Buffer.from(String(stored));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// A device counts as 'active' only while its heartbeat is fresh; otherwise 'inactive'.
// Derived at read time so a device that dies does not stay "online" forever.
const HEARTBEAT_TIMEOUT_SECONDS = parseInt(process.env.HEARTBEAT_TIMEOUT_SECONDS, 10) || 120;
const LIVE_STATUS = `CASE WHEN last_seen IS NOT NULL
  AND last_seen > NOW() - make_interval(secs => ${HEARTBEAT_TIMEOUT_SECONDS})
  THEN 'active' ELSE 'inactive' END`;

module.exports = { validateIdParam, isId, handleDbError, keyMatches, LIVE_STATUS };
