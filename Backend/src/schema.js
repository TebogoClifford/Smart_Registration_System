// schema.js — idempotent schema setup, run on every server start (and by `npm run migrate`).
// Every statement uses IF NOT EXISTS, so running it twice, or on a database that already has
// some of these changes, is safe. This replaces having to remember to run migration scripts.
const pool = require('./db');

const STATEMENTS = [
  // --- base tables (same as schema.sql), so a brand-new empty database starts without any manual step.
  // On an existing database these do nothing.
  `CREATE TABLE IF NOT EXISTS venues (
     id SERIAL PRIMARY KEY,
     name VARCHAR(100) NOT NULL,
     created_at TIMESTAMP DEFAULT NOW()
   )`,
  `CREATE TABLE IF NOT EXISTS devices (
     id SERIAL PRIMARY KEY,
     venue_id INTEGER NOT NULL REFERENCES venues(id),
     name VARCHAR(100) NOT NULL,
     api_key VARCHAR(64) NOT NULL,
     status VARCHAR(20) NOT NULL DEFAULT 'inactive'
   )`,
  `CREATE TABLE IF NOT EXISTS students (
     id SERIAL PRIMARY KEY,
     student_number VARCHAR(20) NOT NULL,
     name VARCHAR(100) NOT NULL,
     device_id INTEGER NOT NULL REFERENCES devices(id),
     enrollment_status VARCHAR(20) NOT NULL DEFAULT 'pending',
     enrollment_image BYTEA
   )`,
  `CREATE TABLE IF NOT EXISTS access_events (
     id SERIAL PRIMARY KEY,
     device_id INTEGER NOT NULL REFERENCES devices(id),
     student_id INTEGER REFERENCES students(id),
     decision VARCHAR(10) NOT NULL,
     event_time TIMESTAMP DEFAULT NOW()
   )`,

  // --- earlier migrations (previously migrate_heartbeat.js / migrate_overrides.js)
  `ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP WITH TIME ZONE`,
  `CREATE TABLE IF NOT EXISTS event_overrides (
     id SERIAL PRIMARY KEY,
     event_id INTEGER NOT NULL REFERENCES access_events(id) ON DELETE CASCADE,
     invigilator_id VARCHAR(255) NOT NULL,
     reason TEXT NOT NULL,
     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE INDEX IF NOT EXISTS idx_overrides_event_id ON event_overrides(event_id)`,

  // --- invigilator accounts
  `CREATE TABLE IF NOT EXISTS users (
     id SERIAL PRIMARY KEY,
     email VARCHAR(255) NOT NULL UNIQUE,
     name VARCHAR(100) NOT NULL,
     password_hash TEXT NOT NULL,
     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
   )`,

  // --- device API: duplicate-proof event uploads (device retries after a WiFi drop)
  `ALTER TABLE access_events ADD COLUMN IF NOT EXISTS client_event_id VARCHAR(64)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_events_device_client_id
     ON access_events (device_id, client_event_id) WHERE client_event_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_events_time ON access_events (event_time DESC)`,

  // --- device API: when enrollment was requested, so abandoned requests expire
  `ALTER TABLE students ADD COLUMN IF NOT EXISTS enrollment_requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()`,
  // --- roles: 'admin' manages venues/devices/accounts; 'invigilator' runs enrolment and exam bookings
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'invigilator'`,

  // --- account details: staff number and phone (optional), disable instead of delete,
  // last sign-in, and "must choose a new password" after an administrator set or reset it
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_number VARCHAR(30)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(30)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_users_staff_number ON users (LOWER(staff_number)) WHERE staff_number IS NOT NULL`,

  // --- venue capacity (0 = not set yet; a venue with no capacity cannot be booked)
  `ALTER TABLE venues ADD COLUMN IF NOT EXISTS capacity INTEGER NOT NULL DEFAULT 0 CHECK (capacity >= 0)`,

  // --- one enrolment photo per student, kept so the device can be re-enrolled (embeddings stay on the device)
  `ALTER TABLE students ADD COLUMN IF NOT EXISTS enrollment_image BYTEA`,
  `ALTER TABLE students ADD COLUMN IF NOT EXISTS enrollment_image_type VARCHAR(30)`,

  // --- course and modules
  `ALTER TABLE students ADD COLUMN IF NOT EXISTS course_name VARCHAR(100)`,
  `CREATE TABLE IF NOT EXISTS modules (
     id SERIAL PRIMARY KEY,
     code VARCHAR(20) NOT NULL UNIQUE,
     name VARCHAR(100) NOT NULL,
     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE TABLE IF NOT EXISTS student_modules (
     student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
     module_id INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
     PRIMARY KEY (student_id, module_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_student_modules_module ON student_modules (module_id)`,

  // --- exam bookings: one module, in one venue, on one date, in one of the two slots
  `CREATE TABLE IF NOT EXISTS exam_bookings (
     id SERIAL PRIMARY KEY,
     module_id INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
     venue_id INTEGER NOT NULL REFERENCES venues(id),
     exam_date DATE NOT NULL,
     slot CHAR(5) NOT NULL CHECK (slot IN ('09:00', '13:00')),
     booked_by VARCHAR(255),
     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
     UNIQUE (module_id, exam_date, slot)
   )`,
  // a reserved seat; venue/date/slot are copied from the booking so the database itself
  // guarantees one seat number per person-place and one seat per student per session
  `CREATE TABLE IF NOT EXISTS seat_reservations (
     booking_id INTEGER NOT NULL REFERENCES exam_bookings(id) ON DELETE CASCADE,
     student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
     venue_id INTEGER NOT NULL,
     exam_date DATE NOT NULL,
     slot CHAR(5) NOT NULL,
     seat_number INTEGER NOT NULL CHECK (seat_number > 0),
     PRIMARY KEY (booking_id, student_id),
     UNIQUE (venue_id, exam_date, slot, seat_number),
     UNIQUE (student_id, exam_date, slot)
   )`,
];

async function ensureSchema() {
  const client = await pool.connect();
  try {
    // advisory lock: two instances starting together will not race on CREATE TABLE
    await client.query('SELECT pg_advisory_lock(727001)');
    for (const sql of STATEMENTS) await client.query(sql);
  } finally {
    await client.query('SELECT pg_advisory_unlock(727001)').catch(() => {});
    client.release();
  }
}

module.exports = { ensureSchema };
