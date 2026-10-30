// /api/modules — exam modules (e.g. PRG101) and who is enrolled in them.
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { validateIdParam, isId, handleDbError } = require('../http');
const { enrol, unenrol, inTransaction } = require('../bookings');

router.param('id', validateIdParam);
router.param('studentId', validateIdParam);

const LIST_SQL = `
  SELECT m.id, m.code, m.name,
         (SELECT COUNT(*)::int FROM student_modules sm WHERE sm.module_id = m.id) AS student_count,
         (SELECT COUNT(*)::int FROM exam_bookings b WHERE b.module_id = m.id) AS booking_count
  FROM modules m`;

router.get('/', async (req, res) => {
  try { res.json((await pool.query(`${LIST_SQL} ORDER BY m.code`)).rows); } catch (err) { handleDbError(res, err); }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`${LIST_SQL} WHERE m.id = $1`, [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'module not found' });
    res.json(rows[0]);
  } catch (err) { handleDbError(res, err); }
});

// Codes are stored upper-case without spaces, so "prg 101" and "PRG101" are the same module.
const cleanCode = (c) => String(c ?? '').toUpperCase().replace(/\s+/g, '');

router.post('/', async (req, res) => {
  const code = cleanCode(req.body?.code);
  const name = req.body?.name;
  if (!code || !name) return res.status(400).json({ error: 'code and name are required' });
  try {
    const { rows } = await pool.query('INSERT INTO modules (code, name) VALUES ($1, $2) RETURNING id, code, name', [code, name]);
    res.status(201).json({ ...rows[0], student_count: 0, booking_count: 0 });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: `module ${code} already exists` });
    handleDbError(res, err);
  }
});

router.put('/:id', async (req, res) => {
  const code = cleanCode(req.body?.code);
  const name = req.body?.name;
  if (!code || !name) return res.status(400).json({ error: 'code and name are required' });
  try {
    const { rows } = await pool.query('UPDATE modules SET code = $1, name = $2 WHERE id = $3 RETURNING id, code, name', [code, name, req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'module not found' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: `module ${code} already exists` });
    handleDbError(res, err);
  }
});

// Blocked while the module has exam bookings: cancel those first so seats are not lost by accident.
router.delete('/:id', async (req, res) => {
  try {
    const b = await pool.query('SELECT COUNT(*)::int AS n FROM exam_bookings WHERE module_id = $1', [req.params.id]);
    if (b.rows[0].n > 0) return res.status(409).json({ error: `Cannot delete module: it has ${b.rows[0].n} exam booking(s). Cancel them first.` });
    const { rows } = await pool.query('DELETE FROM modules WHERE id = $1 RETURNING id', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'module not found' });
    res.status(204).send();
  } catch (err) { handleDbError(res, err); }
});

// GET /api/modules/:id/students — enrolled students, with their seat if the module is booked
router.get('/:id/students', async (req, res) => {
  try {
    const m = await pool.query('SELECT id FROM modules WHERE id = $1', [req.params.id]);
    if (m.rows.length === 0) return res.status(404).json({ error: 'module not found' });
    const { rows } = await pool.query(
      `SELECT s.id, s.student_number, s.name, s.course_name,
              (SELECT json_agg(json_build_object('bookingId', r.booking_id, 'seat', r.seat_number) ORDER BY r.booking_id)
                 FROM seat_reservations r JOIN exam_bookings b ON b.id = r.booking_id
                WHERE r.student_id = s.id AND b.module_id = $1) AS seats
       FROM student_modules sm JOIN students s ON s.id = sm.student_id
       WHERE sm.module_id = $1 ORDER BY s.student_number, s.id`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { handleDbError(res, err); }
});

// POST /api/modules/:id/students  { studentIds: [1,2,3] } — enrol students (seats follow if booked)
router.post('/:id/students', async (req, res) => {
  const ids = req.body?.studentIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500 || !ids.every(isId)) {
    return res.status(400).json({ error: 'studentIds must be a non-empty array of student ids (max 500)' });
  }
  try {
    const m = await pool.query('SELECT id FROM modules WHERE id = $1', [req.params.id]);
    if (m.rows.length === 0) return res.status(404).json({ error: 'module not found' });
    await inTransaction(pool, async (client) => { for (const sid of ids) await enrol(client, Number(sid), Number(req.params.id)); });
    res.status(204).send();
  } catch (err) { handleDbError(res, err); }
});

router.delete('/:id/students/:studentId', async (req, res) => {
  try {
    await inTransaction(pool, (client) => unenrol(client, Number(req.params.studentId), Number(req.params.id)));
    res.status(204).send();
  } catch (err) { handleDbError(res, err); }
});

module.exports = router;
