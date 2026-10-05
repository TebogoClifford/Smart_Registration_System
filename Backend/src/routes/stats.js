const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /api/stats — aggregated daily counts for the dashboard
router.get('/', async (req, res) => {
  try {
    // 1. Count Granted, Denied, and Errors for today
    const eventStats = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE decision = 'granted') as granted,
        COUNT(*) FILTER (WHERE decision = 'denied') as denied,
        COUNT(*) FILTER (WHERE decision NOT IN ('granted', 'denied')) as errors
      FROM access_events
      WHERE event_time >= CURRENT_DATE
    `);

    // 2. Enrollment stats (Enrolled vs Total Students)
    const studentStats = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE enrollment_status = 'enrolled') as enrolled,
        COUNT(*) as total
      FROM students
    `);

    res.json({
      granted: parseInt(eventStats.rows[0].granted),
      denied: parseInt(eventStats.rows[0].denied),
      errors: parseInt(eventStats.rows[0].errors),
      enrolled: studentStats.rows[0].enrolled,
      totalStudents: studentStats.rows[0].total
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  }
});

module.exports = router;