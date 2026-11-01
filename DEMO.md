# Run the demo locally (starts at the sign-in screen)

You need **Node.js 22.18 or newer** (Render runs Node 24, see `Backend/.node-version`) and a PostgreSQL database. A free Neon database works; use a **separate** one, not your real data. Commands are shown for macOS/Linux, with the Windows PowerShell form underneath where it differs.

**1. Backend** – in `Backend/`, create a `.env` file:
```
DATABASE_URL=postgresql://...your demo database...
JWT_SECRET=any-random-text-at-least-32-characters-long
ADMIN_EMAIL=admin@demo.local
ADMIN_PASSWORD=Admin#2026
```
(For a PostgreSQL on your own computer without TLS, add `PGSSL=disable`.) Then:
```
cd Backend
npm install            # install packages
npm start              # applies the Prisma migrations (creates the tables), then starts on http://localhost:3000
```

**2. Demo data** – in a second terminal:
```
cd Backend
SEED_EMAIL=admin@demo.local SEED_PASSWORD='Admin#2026' npm run seed-demo
```
PowerShell: `$env:SEED_EMAIL="admin@demo.local"; $env:SEED_PASSWORD="Admin#2026"; npm run seed-demo`

It adds 3 venues, 3 devices, 6 modules, 40 students, 6 exam bookings and 27 access events, plus two invigilator accounts.
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
You land on the sign-in page. With `VITE_DEMO=true` it shows buttons that fill in the demo accounts:

| Role | Email | Password |
|---|---|---|
| Administrator | admin@demo.local | Admin#2026 |
| Invigilator | nomsa@demo.local | Invigilator#2026 |
| Invigilator | pieter@demo.local | Invigilator#2026 (not on a button; type it in) |

The administrator sees the Accounts page and device keys; invigilators do not.
Leave `VITE_DEMO` out of the real Vercel build so the demo buttons never appear there.

**4. Try a door device** – copy a device key (printed at the end of the seed, or from the device page → **Reveal**). From `Backend/`:
```
BASE_URL=http://localhost:3000 DEVICE_ID=1 DEVICE_KEY=<key> node tools/device-simulator.js
```
PowerShell: `$env:BASE_URL="http://localhost:3000"; $env:DEVICE_ID="1"; $env:DEVICE_KEY="<key>"; node tools/device-simulator.js`

The same flow in Python (from `device_client/`, after `pip install requests`):
```
python simulator.py --url http://localhost:3000 --device-id 1 --key <key> --watch
```
With `--watch` it keeps collecting enrolments: start one on the web console's **Enrolment** page and watch it change to **Enrolled**.

**5. The real door program** – a webcam and, optionally, the Arduino door unit: see [`pc_device/README.md`](pc_device/README.md).
