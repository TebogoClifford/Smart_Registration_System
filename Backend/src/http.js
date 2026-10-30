// http.js — small shared helpers for request validation and database error mapping
const crypto = require('crypto');

// router.param handler: reject non-numeric :id before it reaches the database
// (otherwise the query fails with a type error -> 500).
function validateIdParam(req, res, next, value) {
  if (!/^\d+$/.test(String(value)) || Number(value) > 2147483647) {
    return res.status(400).json({ error: 'id must be a positive integer' });
  }
  next();
}

// True if v is a positive integer (number or numeric string).
const isId = (v) => /^\d+$/.test(String(v)) && Number(v) > 0 && Number(v) <= 2147483647;

// Express middleware: trim every top-level string in the JSON body, so "   " counts as empty
// and stray spaces never end up in names or student numbers.
function trimBody(req, res, next) {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    for (const k of Object.keys(req.body)) {
      if (typeof req.body[k] === 'string') req.body[k] = req.body[k].trim();
    }
  }
  next();
}

// The PostgreSQL error code behind an error, whether it came from Prisma Client (P2xxx codes),
// from a raw query, or from the pg driver underneath.
function pgCode(err) {
  const byPrisma = { P2002: '23505', P2003: '23503', P2000: '22001', P2007: '22P02' };
  if (byPrisma[err?.code]) return byPrisma[err.code];
  const nested = err?.meta?.code ?? err?.meta?.driverAdapterError?.cause?.originalCode ?? err?.cause?.originalCode ?? err?.cause?.code;
  if (/^[0-9A-Z]{5}$/.test(String(nested ?? ''))) return String(nested);
  if (/^[0-9][0-9A-Z]{4}$/.test(String(err?.code ?? ''))) return err.code;
  return null;
}

// Prisma's "record to update/delete does not exist".
const isNotFound = (err) => err?.code === 'P2025';

// Map known database errors to client errors; anything else is a real 500.
function handleDbError(res, err) {
  if (err.name === 'HttpError') { // HttpError from bookings.js: a deliberate, user-facing refusal
    return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  }
  const code = pgCode(err);
  if (code === '23503') { // foreign_key_violation
    return res.status(400).json({ error: 'a referenced venue, device or student does not exist' });
  }
  if (code === '23505') { // unique_violation
    return res.status(409).json({ error: 'a record with those details already exists' });
  }
  if (code === '22001') { // string_data_right_truncation (value longer than the column)
    return res.status(400).json({ error: 'a field is too long' });
  }
  if (code === '22P02' || code === '22007' || code === '22008' || err.name === 'PrismaClientValidationError') { // bad input
    return res.status(400).json({ error: 'one or more fields have an invalid format' });
  }
  if (isNotFound(err)) return res.status(404).json({ error: 'not found' });
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
const liveStatus = (lastSeen) =>
  (lastSeen && Date.now() - new Date(lastSeen).getTime() < HEARTBEAT_TIMEOUT_SECONDS * 1000 ? 'active' : 'inactive');

// 'YYYY-MM-DD' <-> the Date Prisma uses for a DATE column (midnight UTC).
const toDbDate = (s) => new Date(`${s}T00:00:00Z`);
const fromDbDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : d);

module.exports = { trimBody, validateIdParam, isId, handleDbError, pgCode, isNotFound, keyMatches, liveStatus, toDbDate, fromDbDate };
