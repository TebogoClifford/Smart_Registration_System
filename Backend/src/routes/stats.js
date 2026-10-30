const express = require('express');
const router = express.Router();
const prisma = require('../db');

// GET /api/stats — database-backed dashboard summaries and historical trends.
// Reporting queries (FILTER counts, a generated 7-day calendar) have no Prisma Client equivalent, so they
// use Prisma's tagged-template $queryRaw: still one client and connection pool, and no string-built SQL.
router.get('/', async (req, res) => {
  try {
    const [eventStats, studentStats, dailyTrend, topVenues] = await Promise.all([
      prisma.$queryRaw`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE decision = 'granted')::int AS granted,
          COUNT(*) FILTER (WHERE decision = 'denied')::int AS denied,
          COUNT(*) FILTER (WHERE decision NOT IN ('granted', 'denied'))::int AS errors
        FROM access_events
        WHERE event_time >= CURRENT_DATE
          AND event_time < CURRENT_DATE + INTERVAL '1 day'
      `,
      prisma.$queryRaw`
        SELECT
          COUNT(*) FILTER (WHERE enrollment_status = 'enrolled')::int AS enrolled,
          COUNT(*) FILTER (WHERE enrollment_status = 'pending')::int AS pending,
          COUNT(*)::int AS total
        FROM students
      `,
      prisma.$queryRaw`
        WITH days AS (
          SELECT generate_series(
            CURRENT_DATE - INTERVAL '6 days',
            CURRENT_DATE,
            INTERVAL '1 day'
          )::date AS day
        )
        SELECT
          to_char(days.day, 'YYYY-MM-DD') AS date,
          to_char(days.day, 'Dy') AS label,
          COUNT(events.id)::int AS total,
          COUNT(events.id) FILTER (WHERE events.decision = 'granted')::int AS granted,
          COUNT(events.id) FILTER (WHERE events.decision = 'denied')::int AS denied
        FROM days
        LEFT JOIN access_events AS events
          ON events.event_time >= days.day
         AND events.event_time < days.day + INTERVAL '1 day'
        GROUP BY days.day
        ORDER BY days.day
      `,
      prisma.$queryRaw`
        SELECT
          venues.id,
          venues.name,
          COUNT(events.id)::int AS attempts,
          COUNT(events.id) FILTER (WHERE events.decision = 'granted')::int AS granted,
          COUNT(events.id) FILTER (WHERE events.decision = 'denied')::int AS denied
        FROM venues
        LEFT JOIN devices ON devices.venue_id = venues.id
        LEFT JOIN access_events AS events
          ON events.device_id = devices.id
         AND events.event_time >= CURRENT_DATE - INTERVAL '6 days'
         AND events.event_time < CURRENT_DATE + INTERVAL '1 day'
        GROUP BY venues.id, venues.name
        ORDER BY attempts DESC, venues.name ASC
        LIMIT 5
      `
    ]);

    const today = eventStats[0];
    const students = studentStats[0];

    // Keep the original response fields so existing dashboard clients remain compatible.
    res.json({
      total: today.total,
      granted: today.granted,
      denied: today.denied,
      errors: today.errors,
      enrolled: students.enrolled,
      pending: students.pending,
      totalStudents: students.total,
      enrollmentRate: students.total > 0
        ? Math.round((students.enrolled / students.total) * 100)
        : 0,
      dailyTrend,
      topVenues
    });
  } catch (err) {
    console.error('Failed to build dashboard statistics:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

module.exports = router;
