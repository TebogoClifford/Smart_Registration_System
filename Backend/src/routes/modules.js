// /api/modules — exam modules (e.g. PRG101) and who is enrolled in them.
const express = require('express');
const router = express.Router();
const prisma = require('../db');
const { validateIdParam, isId, handleDbError, pgCode, isNotFound } = require('../http');
const { enrol, unenrol, inTransaction } = require('../bookings');

router.param('id', validateIdParam);
router.param('studentId', validateIdParam);

// A module with how many students take it and how many exam bookings it has.
const LIST = { id: true, code: true, name: true, _count: { select: { student_modules: true, exam_bookings: true } } };
const shape = ({ _count, ...m }) => ({ ...m, student_count: _count.student_modules, booking_count: _count.exam_bookings });

router.get('/', async (req, res) => {
  try {
    res.json((await prisma.modules.findMany({ select: LIST, orderBy: { code: 'asc' } })).map(shape));
  } catch (err) { handleDbError(res, err); }
});

router.get('/:id', async (req, res) => {
  try {
    const m = await prisma.modules.findUnique({ where: { id: Number(req.params.id) }, select: LIST });
    if (!m) return res.status(404).json({ error: 'module not found' });
    res.json(shape(m));
  } catch (err) { handleDbError(res, err); }
});

// Codes are stored upper-case without spaces, so "prg 101" and "PRG101" are the same module.
const cleanCode = (c) => String(c ?? '').toUpperCase().replace(/\s+/g, '');
const SELECT = { id: true, code: true, name: true };

router.post('/', async (req, res) => {
  const code = cleanCode(req.body?.code);
  const name = req.body?.name;
  if (!code || !name) return res.status(400).json({ error: 'code and name are required' });
  try {
    const m = await prisma.modules.create({ data: { code, name: String(name) }, select: SELECT });
    res.status(201).json({ ...m, student_count: 0, booking_count: 0 });
  } catch (err) {
    if (pgCode(err) === '23505') return res.status(409).json({ error: `module ${code} already exists` });
    handleDbError(res, err);
  }
});

router.put('/:id', async (req, res) => {
  const code = cleanCode(req.body?.code);
  const name = req.body?.name;
  if (!code || !name) return res.status(400).json({ error: 'code and name are required' });
  try {
    res.json(await prisma.modules.update({ where: { id: Number(req.params.id) }, data: { code, name: String(name) }, select: SELECT }));
  } catch (err) {
    if (isNotFound(err)) return res.status(404).json({ error: 'module not found' });
    if (pgCode(err) === '23505') return res.status(409).json({ error: `module ${code} already exists` });
    handleDbError(res, err);
  }
});

// Blocked while the module has exam bookings: cancel those first so seats are not lost by accident.
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const n = await prisma.exam_bookings.count({ where: { module_id: id } });
    if (n > 0) return res.status(409).json({ error: `Cannot delete module: it has ${n} exam booking(s). Cancel them first.` });
    const { count } = await prisma.modules.deleteMany({ where: { id } });
    if (count === 0) return res.status(404).json({ error: 'module not found' });
    res.status(204).send();
  } catch (err) { handleDbError(res, err); }
});

// GET /api/modules/:id/students — enrolled students, with their seat if the module is booked
router.get('/:id/students', async (req, res) => {
  const id = Number(req.params.id);
  try {
    if (!(await prisma.modules.findUnique({ where: { id }, select: { id: true } }))) return res.status(404).json({ error: 'module not found' });
    const rows = await prisma.student_modules.findMany({
      where: { module_id: id },
      select: {
        students: {
          select: {
            id: true, student_number: true, name: true, course_name: true,
            seat_reservations: {
              where: { exam_bookings: { module_id: id } },
              select: { booking_id: true, seat_number: true },
              orderBy: { booking_id: 'asc' },
            },
          },
        },
      },
      orderBy: [{ students: { student_number: 'asc' } }, { student_id: 'asc' }],
    });
    res.json(rows.map(({ students: { seat_reservations: seats, ...s } }) => ({
      ...s,
      seats: seats.length ? seats.map((r) => ({ bookingId: r.booking_id, seat: r.seat_number })) : null,
    })));
  } catch (err) { handleDbError(res, err); }
});

// POST /api/modules/:id/students  { studentIds: [1,2,3] } — enrol students (seats follow if booked)
router.post('/:id/students', async (req, res) => {
  const ids = req.body?.studentIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500 || !ids.every(isId)) {
    return res.status(400).json({ error: 'studentIds must be a non-empty array of student ids (max 500)' });
  }
  const id = Number(req.params.id);
  try {
    if (!(await prisma.modules.findUnique({ where: { id }, select: { id: true } }))) return res.status(404).json({ error: 'module not found' });
    await inTransaction(prisma, async (tx) => { for (const sid of ids) await enrol(tx, Number(sid), id); });
    res.status(204).send();
  } catch (err) { handleDbError(res, err); }
});

router.delete('/:id/students/:studentId', async (req, res) => {
  try {
    await inTransaction(prisma, (tx) => unenrol(tx, Number(req.params.studentId), Number(req.params.id)));
    res.status(204).send();
  } catch (err) { handleDbError(res, err); }
});

module.exports = router;
