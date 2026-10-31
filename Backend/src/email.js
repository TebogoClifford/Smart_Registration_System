// email.js — emails to students about their exams (booked, moved, cancelled), sent with Brevo's HTTP
// API (https://www.brevo.com; plain HTTPS, so it also works where SMTP ports are blocked).
//
// Every email is first written to the email_outbox table (the web console's Email log), then sent in
// the background, so booking an exam never waits for email or fails because of it.
//
// Settings (environment variables, e.g. on Render):
//   BREVO_API_KEY    Brevo > SMTP & API > API keys. Without it emails are only recorded ("logged").
//   EMAIL_FROM       the sender address verified in Brevo (Senders, domains & dedicated IPs)
//   EMAIL_FROM_NAME  the sender's name (default "Smart Registration System")
//   EMAIL_MODE       "live" = every student gets their email. Anything else = TEST MODE:
//   EMAIL_TEST_TO    in test mode only these addresses (comma-separated) really receive mail;
//                    the others are recorded as "skipped".
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const BATCH = 50;

const setting = (name) => (process.env[name] ?? '').trim();
const testRecipients = () => setting('EMAIL_TEST_TO').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);

// What the console shows about email: whether it is set up and which mode it is in.
function emailStatus() {
  const configured = !!setting('BREVO_API_KEY') && !!setting('EMAIL_FROM');
  const live = setting('EMAIL_MODE').toLowerCase() === 'live';
  return {
    configured, mode: !configured ? 'log' : live ? 'live' : 'test',
    from: setting('EMAIL_FROM') || null, testTo: live ? [] : testRecipients(),
  };
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const longDate = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// One email for one student. exam = { code, name, date, slot, venueName, previous?: { date, slot, venueName } }
function compose(kind, exam, student) {
  const what = `${exam.code} ${exam.name}`;
  const when = `${longDate(exam.date)} at ${exam.slot}`;
  const seat = student.seat ? `Your seat number is ${student.seat}.` : '';
  let subject, lines;
  if (kind === 'cancelled') {
    subject = `Exam cancelled: ${what} on ${exam.date} at ${exam.slot}`;
    lines = [`Your exam for ${what}, which was on ${when} in ${exam.venueName}, has been cancelled.`,
      'You will receive a new email if it is scheduled again.'];
  } else if (kind === 'moved') {
    const p = exam.previous;
    subject = `Exam moved: ${what} is now on ${exam.date} at ${exam.slot}`;
    lines = [`Your exam for ${what} has been moved.`,
      `New: ${when} in ${exam.venueName}.`, p ? `Before: ${longDate(p.date)} at ${p.slot} in ${p.venueName}.` : '', seat,
      'Please arrive 15 minutes early; your face is checked at the door.'];
  } else {
    subject = `Exam scheduled: ${what} on ${exam.date} at ${exam.slot}`;
    lines = [`Your exam for ${what} is scheduled for ${when} in ${exam.venueName}.`, seat,
      'Please arrive 15 minutes early; your face is checked at the door.'];
  }
  lines = lines.filter(Boolean);
  const greeting = `Hello ${student.name},`;
  const sign = 'Smart Registration System';
  return {
    subject,
    text: [greeting, '', ...lines, '', sign].join('\n'),
    html: `<p>${escapeHtml(greeting)}</p>${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('')}<p style="color:#6b7280">${escapeHtml(sign)}</p>`,
  };
}

// Record emails for every student of an exam, then send them in the background.
// students = [{ id, name, email, seat }]. Returns how many were recorded.
async function queueExamEmails(prisma, kind, bookingId, exam, students) {
  const rows = students.map((s) => {
    const m = compose(kind, exam, s);
    return {
      kind, booking_id: bookingId, student_id: s.id, to_email: s.email || '', to_name: s.name,
      subject: m.subject, body_text: m.text, body_html: m.html,
      ...(!s.email && { status: 'skipped', error: 'This student has no email address' }),
    };
  });
  if (rows.length) await prisma.email_outbox.createMany({ data: rows });
  setImmediate(() => processOutbox(prisma).catch((err) => console.error('Email sending failed:', err.message)));
  return rows.length;
}

async function sendOne(row) {
  const res = await fetch(BREVO_URL, {
    method: 'POST',
    headers: { 'api-key': setting('BREVO_API_KEY'), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: setting('EMAIL_FROM'), name: setting('EMAIL_FROM_NAME') || 'Smart Registration System' },
      to: [{ email: row.to_email, name: row.to_name }],
      subject: row.subject, htmlContent: row.body_html, textContent: row.body_text,
    }),
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${body.message || body.code || 'request failed'}`);
  return body.messageId ?? null;
}

let running = false;
// Send every queued email (one at a time; Brevo's free plan allows 300 a day).
async function processOutbox(prisma) {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const queued = await prisma.email_outbox.findMany({ where: { status: 'queued' }, orderBy: { id: 'asc' }, take: BATCH });
      if (!queued.length) break;
      const { configured, mode, testTo } = emailStatus();
      for (const row of queued) {
        let data;
        if (!configured) data = { status: 'logged', error: 'Email is not set up yet (BREVO_API_KEY / EMAIL_FROM)' };
        else if (mode !== 'live' && !testTo.includes(row.to_email.toLowerCase())) data = { status: 'skipped', error: 'Test mode: only EMAIL_TEST_TO addresses receive email' };
        else {
          try { data = { status: 'sent', provider_id: await sendOne(row), sent_at: new Date(), error: null }; }
          catch (err) { data = { status: 'failed', error: err.message.slice(0, 500) }; }
        }
        await prisma.email_outbox.update({ where: { id: row.id }, data });
      }
    }
  } finally { running = false; }
}

module.exports = { emailStatus, compose, queueExamEmails, processOutbox };
