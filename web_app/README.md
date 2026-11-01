# Web console (React + Vite)

The website administrators and invigilators use: dashboard, venues and devices, students and face enrolment, modules, exam bookings and calendar, email log and accounts. It talks only to the backend API; how each page does that is in [`docs/CONNECTION.md`](docs/CONNECTION.md).

* **Live:** deployed on Vercel from `main` (build settings in the root [`vercel.json`](../vercel.json)).
* **Built with:** React 19, React Router, Tailwind CSS 4, shadcn/ui components on Base UI, axios, sonner (toasts), lucide icons.

## Run it locally
Node.js 22.18 or newer. Create `.env.local`:
```
VITE_API_BASE_URL=http://localhost:3000   # your local backend; leave out to use the live Render backend
VITE_DEMO=true                            # optional: buttons that fill in the demo accounts (never in the real build)
# VITE_EXAM_TIMEZONE=Africa/Johannesburg  # optional: the exam time zone (default shown); keep in step with the backend
```
```
npm install
npm run dev        # http://localhost:5173
npm run lint       # ESLint
npm run build      # production build into dist/
npm run preview    # serve that build locally
```
A full local demo with sample data is described in [`../DEMO.md`](../DEMO.md).

## Roles
* **Administrator:** everything, including Accounts, adding and editing venues and devices, and seeing or replacing device keys.
* **Invigilator:** dashboard, students, enrolment, modules, exam bookings, calendar and email log.

## Layout
```
src/App.jsx              routes (each page is loaded when first opened)
src/components/Layout.jsx sidebar, page title and section tabs
src/lib/api.js           every call to the backend
src/lib/exams.js         dates and times in the exam time zone, calendar helpers
src/lib/drafts.js        unsaved form input is kept while you move between pages
src/pages/               one file per page
src/components/          shared parts (dialogs, calendar, Recognised now, …)
src/components/ui/       shadcn/ui building blocks
```
