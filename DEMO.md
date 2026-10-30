# Run the demo locally (starts at the sign-in screen)

You need Node 22 and a Postgres database (a free Neon database works; use a **separate** one, not your real data).

**1. Backend** – in `Backend/`, create a `.env` file:
```
DATABASE_URL=postgresql://...your demo database...
JWT_SECRET=any-random-text-at-least-32-characters-long
ADMIN_EMAIL=admin@demo.local
ADMIN_PASSWORD=Admin#2026
```
Then:
```
cd Backend
npm install            # install packages
npm start              # applies the Prisma migrations (creates the tables), then starts on http://localhost:3000
```

**2. Demo data** – in a second terminal:
```
cd Backend
npm run seed-demo      # 3 venues, 3 devices, 6 modules, 40 students, 6 exam bookings, 27 access events
```
(Windows PowerShell: set the sign-in first, `$env:SEED_EMAIL="admin@demo.local"; $env:SEED_PASSWORD="Admin#2026"`.)
It refuses to run against anything except localhost unless `CONFIRM_SEED=yes` is set, and does nothing if the demo data is already there.

**3. Web app** – in a third terminal. Create `web_app/.env.local`:
```
VITE_API_BASE_URL=http://localhost:3000
VITE_DEMO=true
```
```
cd web_app
npm install
npm run dev            # open the address it prints (usually http://localhost:5173)
```
You land on the sign-in page. With `VITE_DEMO=true` it shows two buttons that fill in the demo accounts:

| Role | Email | Password |
|---|---|---|
| Administrator | admin@demo.local | Admin#2026 |
| Invigilator | nomsa@demo.local | Invigilator#2026 |

The administrator sees the Accounts page and device keys; the invigilator does not.
Leave `VITE_DEMO` out of the real Vercel build so the demo buttons never appear there.

**4. Try a device** – copy a device key (printed at the end of the seed, or from the device page) and run
`BASE_URL=http://localhost:3000 DEVICE_ID=1 DEVICE_KEY=<key> node tools/device-simulator.js` from `Backend/`.
