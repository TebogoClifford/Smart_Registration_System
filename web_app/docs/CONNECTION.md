# Frontend-to-backend connection guide

How the React web console talks to the Node.js/Express backend. Every call goes through one API client, `src/lib/api.js`.

## 1. Communication layer
- **Base URL:** `VITE_API_BASE_URL` (set in `.env.local` for a local backend); without it the Render deployment is used.
- **Format:** JSON over HTTPS. Timeout 60 s, because Render's free plan sleeps and takes up to a minute to wake up.
- **Sign-in:** after `POST /api/auth/login` the token is kept in the browser (`localStorage`) and sent with every request as `Authorization: Bearer <token>`. A `401` signs the user out; a `403` with code `PASSWORD_CHANGE_REQUIRED` opens the change-password screen.
- **Errors:** the client copies the backend's `{ "error": "..." }` into `err.message`, so pages show the real reason in a toast notification (for example "Exam hall 1 does not have enough seats …"). No answer at all → "Cannot reach the server".
- **Times:** shown in the exam time zone (`VITE_EXAM_TIMEZONE`, default `Africa/Johannesburg`, see `src/lib/exams.js`), whatever the viewer's computer is set to.

## 2. Pages and the calls they make

| Page | Action | API method | Backend endpoint | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Sign-in** | Is sign-in required? | `getAuthStatus` | `GET /api/auth/status` | |
| | Sign in | `login` | `POST /api/auth/login` | 5 failed tries per 15 min are refused |
| **My account** | Load / edit own details | `me`, `updateMe` | `GET` / `PUT /api/auth/me` | |
| | Change password | `changePassword` | `PUT /api/auth/password` | Also the forced first-sign-in screen |
| **Dashboard** | Access events | `getAccessEvents` | `GET /api/access-events` | Every 15 s; each event carries device name, student number and name |
| | Figures and charts | `getStats` | `GET /api/stats` | Every 15 s |
| | Recognised now | `getRecognitions` | `GET /api/access-events/recognitions` | Every 3 s |
| | Exam hall bookings (next 14 days) | `getBookings`, `getVenues` | `GET /api/bookings`, `GET /api/venues` | |
| | Override a denied entry | `overrideEvent` | `POST /api/access-events/:id/override` | Records who and why |
| | Export CSV | – | – | Made in the browser from the events shown |
| **Venues & Devices** | List | `getVenues`, `getDevices` | `GET /api/venues`, `GET /api/devices` | Device status every 10 s |
| | Add a venue / device (admin) | `createVenue`, `createDevice` | `POST /api/venues`, `POST /api/devices` | |
| **Venue detail** | Load | `getVenue`, `getDevicesByVenue` | `GET /api/venues/:id`, `GET /api/venues/:id/devices` | |
| | Edit name and capacity (admin) | `updateVenue` | `PUT /api/venues/:id` | |
| | Delete (admin) | `deleteVenue` | `DELETE /api/venues/:id` | Refused while devices or exam bookings use it |
| **Device detail** | Load | `getDevice`, `getVenues`, `getStudents` | `GET /api/devices/:id`, … | The key is only sent to administrators |
| | Edit name and venue (admin) | `updateDevice` | `PUT /api/devices/:id` | |
| | Replace key (admin) | `regenerateDeviceKey` | `POST /api/devices/:id/regenerate-key` | The old key stops working at once |
| | Delete (admin) | `deleteDevice` | `DELETE /api/devices/:id` | Refused while students or access events belong to it |
| **Student list** | List, search, filter | `getStudents`, `getDevices`, `getModules`, `getCourses` | `GET /api/students`, … | Status filter includes *Request expired* |
| **Student detail** | Edit details | `updateStudent` | `PUT /api/students/:id` | A new device sets enrolment back to *pending*, so that device captures the face |
| | Modules | `setStudentModules` | `PUT /api/students/:id/modules` | Seats follow the modules |
| | Enrol face / Re-enrol | `reEnrollStudent` | `POST /api/students/:id/re-enroll` | Polls `GET /api/students/:id` every 3 s |
| | Enrolment photo | `getStudentPhotoUrl` | `GET /api/students/:id/enrollment-image` | |
| | Delete | `deleteStudent` | `DELETE /api/students/:id` | Access history is kept |
| **Enrolment** | Start enrolment | `createStudent` | `POST /api/students` | Creates a *pending* student the device captures |
| | Wait for the device | `getStudent` | `GET /api/students/:id` | Every 3 s until `enrolled` or `failed`; stops when `enrollment_expired` is true |
| | Try again / Re-enrol | `reEnrollStudent` | `POST /api/students/:id/re-enroll` | |
| | Cancel / Edit details | `deleteStudent` | `DELETE /api/students/:id` | Removes the unfinished record |
| **Modules** | List, add, edit, delete | `getModules`, `createModule`, `updateModule`, `deleteModule` | `/api/modules` | Delete refused while the module has bookings |
| | Students of a module | `getModuleStudents`, `addModuleStudents`, `removeModuleStudent` | `/api/modules/:id/students` | |
| **Exam bookings** | Book a hall | `getAvailability`, `getDateAvailability`, `createBooking` | `GET /api/bookings/availability`, `GET /api/bookings/date-availability`, `POST /api/bookings` | Seats every student of the module |
| | Seats | `getBooking` | `GET /api/bookings/:id` | Shows how many can be recognised at the door; **Print sign-in sheet** is made in the browser |
| | Email students | `notifyBooking` | `POST /api/bookings/:id/notify` | Emails every seated student their exam details again |
| | Edit (move) | `updateBooking` | `PUT /api/bookings/:id` | |
| | Cancel | `cancelBooking` | `DELETE /api/bookings/:id` | |
| **Exam calendar** | Month view | `getBookings`, `getVenues` | `GET /api/bookings?from=&to=` | |
| **Email log** | List, mode | `getEmails`, `getEmailStatus` | `GET /api/emails`, `GET /api/emails/status` | |
| | Send failed again | `retryEmails` | `POST /api/emails/retry` | |
| **Accounts** (admin) | List, add, edit, delete | `getUsers`, `createUser`, `updateUser`, `deleteUser` | `/api/users` | |
| | Reset password | `resetUserPassword` | `POST /api/users/:id/reset-password` | Shows a temporary password once |

## 3. Key logic flows

### Refused deletes
1. **UI:** the user confirms a delete → e.g. `api.deleteVenue(id)`.
2. **Backend:** checks for records that depend on it (devices or bookings in the venue).
3. **Response:** `409 Conflict` with a reason, e.g. `{"error": "Cannot delete venue: 2 device(s) still assigned. Remove them first."}`.
4. **UI:** `toast.error(err.message)` shows that reason.

### Live updates (polling)
The backend cannot push to the browser, so pages ask again on a timer (`setInterval` in a `useEffect`): the Dashboard's events and figures every 15 s, *Recognised now* every 3 s, device status every 10 s, and a running enrolment every 3 s.
