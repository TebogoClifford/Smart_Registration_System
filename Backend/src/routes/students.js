const express = require('express');
const router = express.Router();
const prisma = require('../db');
const { validateIdParam, isId, handleDbError, keyMatches } = require('../http');
const { enrol, unenrol, inTransaction } = require('../bookings');
const { COURSES, checkCourse } = require('../courses');

// Explicit field list: never load the enrolment photo (bytes) here; has_image says whether there is one.
const STUDENT_SELECT = {
  id: true, student_number: true, name: true, device_id: true, enrollment_status: true, enrollment_requested_at: true, course_name: true,
  student_modules: { select: { modules: { select: { id: true, code: true, name: true } } }, orderBy: { modules: { code: 'asc' } } },
};
const shape = ({ student_modules: sm, ...s }, withImage) => ({ ...s, has_image: withImage.has(s.id), modules: sm.map((x) => x.modules) });
// ids (of `ids`, or of everyone) that have an enrolment photo, without loading the photos
const idsWithImage = async (ids) => new Set((await prisma.students.findMany({
  where: { enrollment_image: { not: null }, ...(ids && { id: { in: ids } }) }, select: { id: true },
})).map((r) => r.id));
async function getStudent(id) {
  const s = await prisma.students.findUnique({ where: { id: Number(id) }, select: STUDENT_SELECT });
  return s ? shape(s, await idsWithImage([s.id])) : undefined;
}
// the device a student is enrolled on, with its key (to check X-Device-Key)
const studentDevice = (id) => prisma.students.findUnique({ where: { id: Number(id) }, select: { id: true, devices: { select: { api_key: true } } } });

const BAD_COURSE = `course_name must be one of: ${COURSES.join('; ')}`;

router.param('id', validateIdParam);

// POST /api/students — start enrollment (status defaults to 'pending')
router.post('/', async (req, res) => {
  const { student_number, name, device_id } = (req.body ?? {});
  const course_name = checkCourse(req.body?.course_name);
  if (!student_number || !name || !device_id) {
    return res
      .status(400)
      .json({ error: 'student_number, name, and device_id are required' });
  }
  if (course_name === undefined) return res.status(400).json({ error: BAD_COURSE });
  if (!isId(device_id)) return res.status(400).json({ error: 'device_id must be a positive integer' });
  try {
    // Same student enrolled twice on the same device would give two embeddings for one person.
    const dup = await prisma.students.findFirst({ where: { student_number: String(student_number), device_id: Number(device_id) }, select: { id: true } });
    if (dup) {
      return res.status(409).json({ error: 'this student number is already registered on that device' });
    }
    const created = await prisma.students.create({
      data: {
        student_number: String(student_number), name: String(name), device_id: Number(device_id), course_name,
        enrollment_status: 'pending', enrollment_requested_at: new Date(),
      },
      select: { id: true },
    });
    res.status(201).json(await getStudent(created.id));
  } catch (err) {
    handleDbError(res, err);
  }
});

// GET /api/students — list all students
router.get('/', async (req, res) => {
  try {
    const [rows, withImage] = await Promise.all([
      prisma.students.findMany({ select: STUDENT_SELECT, orderBy: { id: 'asc' } }),
      idsWithImage(),
    ]);
    res.json(rows.map((s) => shape(s, withImage)));
  } catch (err) {
    handleDbError(res, err);
  }
});

// GET /api/students/:id
router.get('/:id', async (req, res) => {
  try {
    const student = await getStudent(req.params.id);
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
  if (!student_number || !name || !device_id) {
    return res.status(400).json({ error: 'student_number, name, and device_id are required' });
  }
  if (!isId(device_id)) return res.status(400).json({ error: 'device_id must be a positive integer' });
  try {
    // a course saved before the list existed may stay as it is
    const current = await prisma.students.findUnique({ where: { id: Number(id) }, select: { course_name: true } });
    const course_name = checkCourse(req.body?.course_name, current?.course_name);
    if (course_name === undefined) return res.status(400).json({ error: BAD_COURSE });
    const dup = await prisma.students.findFirst({
      where: { student_number: String(student_number), device_id: Number(device_id), id: { not: Number(id) } }, select: { id: true },
    });
    if (dup) {
      return res.status(409).json({ error: 'this student number is already registered on that device' });
    }
    const { count } = await prisma.students.updateMany({
      where: { id: Number(id) },
      data: { student_number: String(student_number), name: String(name), device_id: Number(device_id), course_name },
    });
    if (count === 0) return res.status(404).json({ error: 'student not found' });
    res.json(await getStudent(id));
  } catch (err) {
    handleDbError(res, err);
  }
});

// POST /api/students/:id/re-enroll — ask the device to capture this student again
// (after a failed capture, or to replace a poor one). The device picks it up on its next poll.
router.post('/:id/re-enroll', async (req, res) => {
  try {
    const { count } = await prisma.students.updateMany({
      where: { id: Number(req.params.id) },
      data: { enrollment_status: 'pending', enrollment_requested_at: new Date() },
    });
    if (count === 0) return res.status(404).json({ error: 'student not found' });
    res.json(await getStudent(req.params.id));
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
    const found = await studentDevice(req.params.id);
    if (!found?.devices) return res.status(404).json({ error: 'student not found' });
    if (!keyMatches(req.get('X-Device-Key'), found.devices.api_key)) {
      return res.status(401).json({ error: 'invalid or missing device key' });
    }
    await prisma.students.update({ where: { id: found.id }, data: { enrollment_status: status } });
    res.json(await getStudent(found.id));
  } catch (err) {
    handleDbError(res, err);
  }
});

// DELETE /api/students/:id — access history is kept (audit trail): events lose the student link
// (access_events.student_id is nullable) instead of blocking the delete or being removed.
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const deleted = await prisma.$transaction(async (tx) => {
      await tx.access_events.updateMany({ where: { student_id: id }, data: { student_id: null } });
      return (await tx.students.deleteMany({ where: { id } })).count;
    });
    if (deleted === 0) return res.status(404).json({ error: 'student not found' });
    res.status(204).send();
  } catch (err) {
    handleDbError(res, err);
  }
});

// GET /api/students/:id/modules, PUT /api/students/:id/modules { moduleIds: [...] }
// PUT replaces the whole set. Seats follow: new modules that are already booked reserve a seat,
// dropped modules free theirs. If any seat cannot be given (hall full, clash) nothing changes.
router.get('/:id/modules', async (req, res) => {
  try {
    const student = await getStudent(req.params.id);
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
    const sid = Number(req.params.id);
    if (!(await prisma.students.findUnique({ where: { id: sid }, select: { id: true } }))) return res.status(404).json({ error: 'student not found' });
    await inTransaction(prisma, async (tx) => {
      const have = (await tx.student_modules.findMany({ where: { student_id: sid }, select: { module_id: true } })).map((r) => r.module_id);
      for (const m of have.filter((x) => !wanted.includes(x))) await unenrol(tx, sid, m);
      for (const m of wanted.filter((x) => !have.includes(x))) await enrol(tx, sid, m);
    });
    res.json((await getStudent(sid)).modules);
  } catch (err) { handleDbError(res, err); }
});

// PUT /api/students/:id/enrollment-image — the device uploads ONE enrolment photo (JPEG, max 1 MB)
// so the student can be re-enrolled later without the camera. Face embeddings never leave the device.
router.put('/:id/enrollment-image', express.raw({ type: 'image/jpeg', limit: '1mb' }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(415).json({ error: 'send the photo as the raw body with Content-Type: image/jpeg (max 1 MB)' });
  }
  try {
    const found = await studentDevice(req.params.id);
    if (!found?.devices) return res.status(404).json({ error: 'student not found' });
    if (!keyMatches(req.get('X-Device-Key'), found.devices.api_key)) return res.status(401).json({ error: 'invalid or missing device key' });
    await prisma.students.update({ where: { id: found.id }, data: { enrollment_image: req.body, enrollment_image_type: 'image/jpeg' } });
    res.status(204).send();
  } catch (err) { handleDbError(res, err); }
});

// GET /api/students/:id/enrollment-image — for the web console (signed-in users only)
router.get('/:id/enrollment-image', async (req, res) => {
  try {
    const row = await prisma.students.findUnique({ where: { id: Number(req.params.id) }, select: { enrollment_image: true, enrollment_image_type: true } });
    if (!row) return res.status(404).json({ error: 'student not found' });
    if (!row.enrollment_image) return res.status(404).json({ error: 'no enrolment photo stored' });
    res.set('Content-Type', row.enrollment_image_type || 'image/jpeg').set('Cache-Control', 'private, no-store').send(Buffer.from(row.enrollment_image));
  } catch (err) { handleDbError(res, err); }
});

module.exports = router;
