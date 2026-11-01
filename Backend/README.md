# Backend (Node.js + Express + Prisma)

The API behind the web console and the door devices. It stores venues, devices, students, modules, exam bookings, seats, access events and emails in PostgreSQL (Neon), and signs students out when their exam session ends.

* **Live:** `https://smart-registration-system.onrender.com` (Render, deploys `main` automatically; `GET /health` answers `{"status":"ok"}`).
* **Device API** (door PC / ESP32): [`DEVICE_API.md`](DEVICE_API.md). **Web console calls:** [`../web_app/docs/CONNECTION.md`](../web_app/docs/CONNECTION.md).

## Run it locally
Node.js 22.18 or newer (Render uses 24, see `.node-version`) and a PostgreSQL database.
```
cp .env.example .env      # Windows: copy .env.example .env   – then fill in DATABASE_URL, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm install               # also generates the Prisma client
npm start                 # applies the database migrations, then listens on http://localhost:3000
```
The first administrator is created from `ADMIN_EMAIL` / `ADMIN_PASSWORD` when there are no accounts yet. Demo data: see [`../DEMO.md`](../DEMO.md).

## Settings (environment variables)
All are listed with explanations in [`.env.example`](.env.example). The important ones:

| Variable | Needed | What it does |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string. Migrations use the direct host (without `-pooler`) or `DIRECT_URL` |
| `JWT_SECRET` | yes | 32+ random characters; the server refuses to start without it (`AUTH_DISABLED=true` is for local tests only) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | first start | The first administrator account |
| `CORS_ORIGIN` | recommended | Comma-separated web addresses allowed to call the API from a browser |
| `EXAM_TIMEZONE` | no | Default `Africa/Johannesburg`: decides the 09:00 / 13:00 session and the 12:00 / 16:00 sign-out |
| `ENROLL_REQUEST_TTL_SECONDS` | no | Default 600: a capture request no device collected expires after this |
| `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_TEST_TO`, `EMAIL_MODE` | for emails | Without the first two, exam emails are only recorded in the Email log. With them, only `EMAIL_TEST_TO` receives email until `EMAIL_MODE=live` |

## Scripts
| Command | What it does |
|---|---|
| `npm start` | Migrate the database, then start the server (what Render runs) |
| `npm run dev` | Start with automatic restart on file changes (no migration) |
| `npm run migrate` | Apply database migrations only |
| `npm run migrate:new -- --name <name>` | Create a new migration from changes in `prisma/schema.prisma` |
| `npm run studio` | Browse the database in Prisma Studio |
| `npm run create-user -- <email> "<Full Name>" <password> [admin\|invigilator]` | Add an account from the command line |
| `node tools/reset-password.js <email> <new-password>` | Set a new password for an account |
| `npm run seed-demo` / `seed-exams` / `seed-activity` | Sample data for demos (refuses anything but localhost unless `CONFIRM_SEED=yes`) |
| `node tools/device-simulator.js` | Plays a door device against a running backend |
| `npm run lint` | Check the code with ESLint |

## Tests
The tests call a running server, so start one first (each in its own terminal):
```
AUTH_DISABLED=true PORT=3111 npm start
BASE_URL=http://localhost:3111 node --test --test-concurrency=1 test/api.test.js test/booking.test.js test/extra.test.js test/signout.test.js
```
Sign-in and roles need a second server with sign-in on and its own database:
```
JWT_SECRET=<32+ chars> ADMIN_EMAIL=admin@test.local ADMIN_PASSWORD=adminpass1 PORT=3112 npm start
AUTH_BASE_URL=http://localhost:3112 node --test test/auth.test.js
```
Use test databases, never the real one. GitHub runs exactly this on every push (`.github/workflows/ci.yml`).

## Layout
```
src/server.js        start-up, routes, error handling
src/auth.js          passwords (scrypt), sign-in tokens (JWT), the gate in front of /api
src/deviceAuth.js    checks a device's X-Device-Key
src/bookings.js      seat rules, exam sessions (09:00 / 13:00) and their end times
src/signout.js       automatic sign-out at 12:00 / 16:00
src/inside.js        "already inside" (let in once per session)
src/email.js         exam emails through Brevo, with the Email log
src/routes/*.js      one file per API area
prisma/              database schema and migrations
tools/               seed scripts, device simulator, password reset
test/                API tests (node:test)
```
