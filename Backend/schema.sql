-- schema.sql — base tables from the Design Document (section 8.3).
-- Run once on a fresh database, then `npm run migrate` for the later additions
-- (devices.last_seen and the event_overrides audit table).
CREATE TABLE IF NOT EXISTS venues (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS devices (
  id SERIAL PRIMARY KEY,
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  name VARCHAR(100) NOT NULL,
  api_key VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'inactive'
);
CREATE TABLE IF NOT EXISTS students (
  id SERIAL PRIMARY KEY,
  student_number VARCHAR(20) NOT NULL,
  name VARCHAR(100) NOT NULL,
  device_id INTEGER NOT NULL REFERENCES devices(id),
  enrollment_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  enrollment_image BYTEA
);
CREATE TABLE IF NOT EXISTS access_events (
  id SERIAL PRIMARY KEY,
  device_id INTEGER NOT NULL REFERENCES devices(id),
  student_id INTEGER REFERENCES students(id),
  decision VARCHAR(10) NOT NULL,
  event_time TIMESTAMP DEFAULT NOW()
);
