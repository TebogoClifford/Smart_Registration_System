const express = require('express');
const router = express.Router();
const pool = require('../db');
const { validateIdParam, isId, handleDbError, keyMatches } = require('../http');
const { enrol, unenrol, inTransaction } = require('../bookings');

// Explicit column list: never SELECT * here, because the row also holds the enrolment photo (BYTEA).
const STUDENT_SELECT = `
  s.id, s.student_number, s.name, s.device_id, s.enrollment_status, s.enrollment_requested_at, s.course_name,
  (s.enrollment_image IS NOT NULL) AS has_image,
  COALESCE((SELECT json_agg(json_build_object('id', m.id, 'code', m.code, 'name', m.name) ORDER BY m.code)
              FROM student_modules sm JOIN modules m ON m.id = sm.module_id WHERE sm.student_id = s.id), '[]'::json) AS modules`;
const getStudent = async (db, id) => (await db.query(`SELECT ${STUDENT_SELECT} FROM students s WHERE s.id = $1`, [id])).rows[0];

const cleanCourse = (c) => (c === undefined || c === null || String(c).trim() === '' ? null : String(c).trim());

router.param('id', validateIdParam);

// POST /api/students — start enrollment (status defaults to 'pending')
router.post('/', async (req, res) => {
  const { student_number, name, device_id } = (req.body ?? {});
  const course_name = cleanCourse(req.body?.course_name);
  if (!student_number || !name || !device_id) {
    return res
      .status(400)
      .json({ error: 'student_number, name, and device_id are required' });
  }
  if (!isId(device_id)) return res.status(400).json({ error: 'device_id must be a positive integer' });
  try {
    // Same student enrolled twice on the same device would give two embeddings for one person.
    const dup = await pool.query(
      'SELECT id FROM students WHERE student_number = $1 AND device_id = $2',
      [student_number, device_id]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: 'this student number is already registered on that device' });
    }
    const result = await pool.query(
      `INSERT INTO students (student_number, name, device_id, course_name, enrollment_status, enrollment_requested_at)
       VALUES ($1, $2, $3, $4, 'pending', NOW()) RETURNING id`,
      [student_number, name, device_id, course_name]
    );
    res.status(201).json(await getStudent(pool, result.rows[0].id));
  } catch (err) {
    handleDbError(res, err);
  }
});

// GET /api/students — list all students
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`SELECT ${STUDENT_SELECT} FROM students s ORDER BY s.id`);
    res.json(result.rows);
  } catch (err) {
    handleDbError(res, err);
  }
});

// GET /api/students/:id
router.get('/:id', async (req, res) => {
  try {
    const student = await getStudent(pool, req.params.id);
    if (!student) return res.status(404).json({ error: 'student not found' });
    res.json(student);
  } catch (err) {
    handleDbError(res, err);
  }
});

// PUT /api/students/:id — edit name/number/device assignment
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { student_number, name, device_id } = (req.body ?? {});
  const course_name = cleanCourse(req.body?.course_name);
  if (!student_number || !name || !device_id) {
    return res.status(400).json({ error: 'student_number, name, and device_id are required' });
  }
  if (!isId(device_id)) return res.status(400).json({ error: 'device_id must be a positive integer' });
  try {
    const dup = await pool.query(
      'SELECT id FROM students WHERE student_number = $1 AND device_id = $2 AND id <> $3',
      [student_number, device_id, id]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: 'this student number is already registered on that device' });
    }
    const result = await pool.query(
      'UPDATE students SET student_number = $1, name = $2, device_id = $3, course_name = $4 WHERE id = $5 RETURNING id',
      [student_number, name, device_id, course_name, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'student not found' });
    res.json(await getStudent(pool, id));
  } catch (err) {
    handleDbError(res, err);
  }
});

// POST /api/students/:id/re-enroll — ask the device to capture this student again
// (after a failed capture, or to replace a poor one). The device picks it up on its next poll.
router.post('/:id/re-enroll', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE students SET enrollment_status = 'pending', enrollment_requested_at = NOW()
       WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'student not found' });
    res.json(await getStudent(pool, req.params.id));
  } catch (err) {
    handleDbError(res, err);
  }
});

// PUT /api/students/:id/enrollment — the device reports the outcome of an enrollment capture
// (design: Student Enrollment, step 7-8). Needs the device's key in X-Device-Key.
router.put('/:id/enrollment', async (req, res) => {
  const { status } = (req.body ?? {});
  if (!['enrolled', 'failed'].includes(status)) {
    return res.status(400).json({ error: "status must be 'enrolled' or 'failed'" });
  }
  try {
    const found = await pool.query(
      `SELECT s.id, d.api_key FROM students s JOIN devices d ON d.id = s.device_id WHERE s.id = $1`,
      [req.params.id]
    );
    if (found.rows.length === 0) return res.status(404).json({ error: 'student not found' });
    if (!keyMatches(req.get('X-Device-Key'), found.rows[0].api_key)) {
      return res.status(401).json({ error: 'invalid or missing device key' });
    }
    await pool.query('UPDATE students SET enrollment_status = $1 WHERE id = $2', [status, req.params.id]);
    res.json(await getStudent(pool, req.params.id));
  } catch (err) {
    handleDbError(res, err);
  }
});

// DELETE /api/students/:id — access history is kept (audit trail): events lose the student link
// (access_events.student_id is nullable) instead of blocking the delete or being removed.
router.delete('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE access_events SET student_id = NULL WHERE student_id = $1', [req.params.id]);
    const result = await client.query('DELETE FROM students WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'student not found' });
    }
    await client.query('COMMIT');
    res.status(204).send();
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    handleDbError(res, err);
  } finally {
    client.release();
  }
});

// GET /api/students/:id/modules, PUT /api/students/:id/modules { moduleIds: [...] }
// PUT replaces the whole set. Seats follow: new modules that are already booked reserve a seat,
// dropped modules free theirs. If any seat cannot be given (hall full, clash) nothing changes.
router.get('/:id/modules', async (req, res) => {
  try {
    const student = await getStudent(pool, req.params.id);
    if (!student) return res.status(404).json({ error: 'student not found' });
    res.json(student.modules);
  } catch (err) { handleDbError(res, err); }
});

router.put('/:id/modules', async (req, res) => {
  const ids = req.body?.moduleIds;
  if (!Array.isArray(ids) || ids.length > 50 || !ids.every(isId)) {
    return res.status(400).json({ error: 'moduleIds must be an array of module ids (max 50)' });
  }
  const wanted = [...new Set(ids.map(Number))];
  try {
    if (!(await getStudent(pool, req.params.id))) return res.status(404).json({ error: 'student not found' });
    await inTransaction(pool, async (client) => {
      const sid = Number(req.params.id);
      const have = (await client.query('SELECT module_id FROM student_modules WHERE student_id = $1', [sid])).rows.map((r) => r.module_id);
      for (const m of have.filter((x) => !wanted.includes(x))) await unenrol(client, sid, m);
      for (const m of wanted.filter((x) => !have.includes(x))) await enrol(client, sid, m);
    });
    res.json((await getStudent(pool, req.params.id)).modules);
  } catch (err) { handleDbError(res, err); }
});

// PUT /api/students/:id/enrollment-image — the device uploads ONE enrolment photo (JPEG, max 1 MB)
// so the student can be re-enrolled later without the camera. Face embeddings never leave the device.
router.put('/:id/enrollment-image', express.raw({ type: 'image/jpeg', limit: '1mb' }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(415).json({ error: 'send the photo as the raw body with Content-Type: image/jpeg (max 1 MB)' });
  }
  try {
    const found = await pool.query(
      'SELECT s.id, d.api_key FROM students s JOIN devices d ON d.id = s.device_id WHERE s.id = $1', [req.params.id]);
    if (found.rows.length === 0) return res.status(404).json({ error: 'student not found' });
    if (!keyMatches(req.get('X-Device-Key'), found.rows[0].api_key)) return res.status(401).json({ error: 'invalid or missing device key' });
    await pool.query('UPDATE students SET enrollment_image = $1, enrollment_image_type = $2 WHERE id = $3', [req.body, 'image/jpeg', req.params.id]);
    res.status(204).send();
  } catch (err) { handleDbError(res, err); }
});

// GET /api/students/:id/enrollment-image — for the web console (signed-in users only)
router.get('/:id/enrollment-image', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT enrollment_image, enrollment_image_type FROM students WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'student not found' });
    if (!rows[0].enrollment_image) return res.status(404).json({ error: 'no enrolment photo stored' });
    res.set('Content-Type', rows[0].enrollment_image_type || 'image/jpeg').set('Cache-Control', 'private, no-store').send(rows[0].enrollment_image);
  } catch (err) { handleDbError(res, err); }
});

module.exports = router;
