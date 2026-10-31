-- Every student has an email address; students already in the system get <student number>@tut4life.ac.za.
ALTER TABLE students ADD COLUMN IF NOT EXISTS email VARCHAR(255);
UPDATE students SET email = student_number || '@tut4life.ac.za' WHERE email IS NULL OR email = '';

-- Emails to students about their exams (booked, moved, cancelled): one row per email, with what
-- happened to it. booking_id has no foreign key on purpose: a cancelled booking is deleted, its
-- cancellation emails stay.
CREATE TABLE IF NOT EXISTS email_outbox (
  id          SERIAL PRIMARY KEY,
  kind        VARCHAR(20)  NOT NULL,                  -- booked | moved | cancelled
  booking_id  INTEGER,
  student_id  INTEGER REFERENCES students(id) ON DELETE SET NULL,
  to_email    VARCHAR(255) NOT NULL,
  to_name     VARCHAR(100) NOT NULL,
  subject     VARCHAR(255) NOT NULL,
  body_text   TEXT         NOT NULL,
  body_html   TEXT         NOT NULL,
  status      VARCHAR(20)  NOT NULL DEFAULT 'queued', -- queued | sent | failed | skipped | logged
  error       TEXT,
  provider_id VARCHAR(255),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  sent_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_email_outbox_created ON email_outbox (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_outbox_status ON email_outbox (status);
