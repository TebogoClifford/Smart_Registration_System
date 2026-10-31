// /api/emails — the Email log: exam emails to students and what happened to each.
const express = require('express');
const router = express.Router();
const prisma = require('../db');
const { handleDbError } = require('../http');
const { emailStatus, processOutbox } = require('../email');

const STATUSES = ['queued', 'sent', 'failed', 'skipped', 'logged'];

// GET /api/emails/status — is email set up, and in which mode (log / test / live)
router.get('/status', (req, res) => res.json(emailStatus()));

// GET /api/emails?status=&limit= — newest first (default 100, max 500), with counts per status
router.get('/', async (req, res) => {
  const { status } = req.query;
  if (status !== undefined && !STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
  try {
    const [rows, counts] = await Promise.all([
      prisma.email_outbox.findMany({
        where: status ? { status } : {},
        select: { id: true, kind: true, booking_id: true, student_id: true, to_email: true, to_name: true, subject: true, body_text: true, status: true, error: true, created_at: true, sent_at: true },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }], take: limit,
      }),
      prisma.email_outbox.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    res.json({ emails: rows, counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])), ...emailStatus() });
  } catch (err) { handleDbError(res, err); }
});

// POST /api/emails/retry — send failed emails again (e.g. after fixing the Brevo settings)
router.post('/retry', async (req, res) => {
  try {
    const { count } = await prisma.email_outbox.updateMany({ where: { status: 'failed' }, data: { status: 'queued', error: null } });
    setImmediate(() => processOutbox(prisma).catch((err) => console.error('Email sending failed:', err.message)));
    res.json({ requeued: count });
  } catch (err) { handleDbError(res, err); }
});

module.exports = router;
