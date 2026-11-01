# Device API (door device ⇄ backend)

How a door device talks to the backend. The door device in use is the PC program ([`../pc_device`](../pc_device/README.md), through [`../device_client/srs_client.py`](../device_client/srs_client.py)); an ESP32-CAM would use the same calls.

Plain HTTP(S) with JSON. The backend cannot call the device (it sits behind a router), so the device **polls**.

* **Base URL:** the Render address, e.g. `https://smart-registration-system.onrender.com`. Render only serves HTTPS (an ESP32 needs `esp_http_client` with the certificate bundle).
* **Cold start:** Render's free plan sleeps after 15 minutes without requests. The first call after that can take 30–60 s. Use a 60 s timeout, and call `GET /health` at start-up until it answers `{"status":"ok"}`.
* **Identity:** every device call sends `X-Device-Key: <key>`. The id and key are shown (administrators only) on the device's page in the web console. Wrong key → `401`, unknown device → `404`. Any accepted call also counts as a heartbeat.
  An administrator can replace a key (device page → **Replace**, or `POST /api/devices/{id}/regenerate-key`); the old key stops working at once.
* **Errors:** always JSON `{ "error": "message" }`. `4xx` = fix the request, do not retry. `5xx` or no answer = retry later.

## Start-up sequence
1. `GET /health` until `ok`.
2. `GET /api/devices/{id}/config` – read the settings.
3. `GET /api/devices/{id}/roster` – delete stored faces of students no longer on this device.
4. `GET /api/devices/{id}/session` – load who has a seat now.
5. Loop: heartbeat (every `heartbeatIntervalSeconds`), poll enrolments (every `enrollmentPollSeconds`), upload queued events, refresh the session every few minutes and at 12:00 and 16:00, and the roster every few minutes.

## Endpoints

### POST /api/devices/heartbeat
Body `{ "deviceId": 3 }` → `200 { "status": "ok", "serverTime": "2026-10-12T07:00:00.000Z" }`.
Use `serverTime` to set the clock (NTP is better).

### GET /api/devices/{id}/config
```json
{ "deviceId": 3, "name": "Entrance Cam", "venueId": 2, "captureDistanceCm": 30,
  "heartbeatIntervalSeconds": 30, "enrollmentPollSeconds": 3, "eventBatchMax": 100, "serverTime": "…" }
```

### GET /api/devices/{id}/pending-enrollments
Students an invigilator asked this device to capture. Requests older than `ENROLL_REQUEST_TTL_SECONDS` (server setting, default 600 = 10 minutes) are left out; the web console then shows them as *request expired*. `[]` when none.
```json
[ { "studentId": 17, "studentNumber": "220123456", "name": "Thabo M." } ]
```

### Enrolment flow
1. Poll `pending-enrollments`. For each student: tell the invigilator / show it on the device, wait until the student is at `captureDistanceCm`, capture and compute the embedding. Embeddings stay on the device.
2. Optional: `PUT /api/students/{studentId}/enrollment-image` with header `Content-Type: image/jpeg` and the JPEG as the raw body (max 1 MB). Stored only so the web console can show the photo and the student can be re-enrolled. → `204`.
3. Report the result: `PUT /api/students/{studentId}/enrollment` with `{ "status": "enrolled" }` or `{ "status": "failed" }` → `200` (the student record). The key must be the key of the student's own device (`401` otherwise). A failed student can be retried from the web console (**Re-enrol**).

### GET /api/devices/{id}/roster
Students enrolled on this device (all sessions). Delete any stored face whose `studentId` is no longer listed (the student was deleted or moved to another device).
`[ { "studentId": 17, "studentNumber": "220123456", "name": "Thabo M." } ]`

### GET /api/devices/{id}/session[?date=YYYY-MM-DD&slot=09:00]
The exam session in this device's venue **now** (or on the given date and slot). Without parameters the server uses the current session in `EXAM_TIMEZONE` (default `Africa/Johannesburg`): before 12:00 → `09:00`, otherwise `13:00`.
Sessions end at 12:00 (`09:00` slot) and 16:00 (`13:00` slot): everyone let in is then signed out automatically (the server records a `signed_out` event).
```json
{ "venueId": 2, "date": "2026-10-12", "slot": "09:00",
  "endsAt": "2026-10-12T10:00:00.000Z", "ended": false, "serverTime": "…",
  "students": [ { "studentId": 17, "studentNumber": "220123456", "name": "Thabo M.",
                  "seatNumber": 4, "moduleCode": "PRG101", "onThisDevice": true } ],
  "alreadyInside": [ 17 ],
  "sessionEndedFor": [] }
```
* `students` – everyone with a seat in this venue and session. `onThisDevice` is `true` when their face is enrolled on this device.
* `alreadyInside` – ids of students let in during this session at any door (empty once it has ended), so a restarted device still answers "already inside".
* `sessionEndedFor` – between 12:00 and 13:00: ids of students whose morning exam is over and who have no afternoon seat. From 13:00 the afternoon is a new session, so a student signed out at 12:00 may sign in again.

**How the PC program decides** (`pc_device/srs_pc_app.py`): a face is compared with every face stored on the PC. No match → `denied`; a face that matches two enrolled students → `denied` too (one face belongs to one student). One match → `granted` once per session (the banner adds the seat from `students` when there is one, or "no exam seat in this session"); seen again in the same session → `already`; after their session has ended → `ended`. The seat list does not decide entry: the invigilator sees on the web console who has no seat. In the door PC's Admin mode a recognised student is let in at any time, even again in the same session.

### POST /api/access-events
One decision. Body:
```json
{ "deviceId": 3, "decision": "granted", "studentId": 17, "clientEventId": "3-000142", "secondsAgo": 12 }
```
* `decision`: `granted` | `denied` | `error` (capture or match failed) | `already` (let in earlier this session) | `ended` (their session is over: not let in). `studentId` may be left out for an unknown face. The server has the last word: a student is let in once per session, so a second `granted` in a session is stored as `already`, and any decision after their session ended as `ended`. (`signed_out` is recorded by the server only.)
* `admin` (optional, `true`): the door PC's Admin mode let this student in at any time. A `granted` with `admin: true` is stored as
  `granted` as sent (never turned into `already` / `ended`), and one after the session ended gets no automatic sign-out.
* `clientEventId` (max 64 characters): unique per device, e.g. `deviceId-time-counter`. If an upload is repeated after a WiFi drop, the server answers `200` with the original event instead of storing a second one. `201` = created.
* When it happened: `timestamp` (ISO 8601, only if the device clock is set; at most 30 days old and 5 minutes in the future) **or** `secondsAgo` (0–2 592 000) **or** neither (= now).
* A `studentId` that does not exist → `400`.

### POST /api/access-events/batch
Upload a queue after being offline. Body `{ "deviceId": 3, "events": [ {…same fields…}, … ] }` (1–100 events). **`clientEventId` is required for every event in a batch.** The answer is `200` with one result per event, in order, so one bad event never blocks the rest:
```json
{ "results": [ { "index": 0, "clientEventId": "3-000142", "status": "created", "id": 91 },
               { "index": 1, "clientEventId": "3-000143", "status": "duplicate", "id": 77 },
               { "index": 2, "clientEventId": "3-000144", "status": "rejected", "error": "decision must be 'granted', 'denied', 'error', 'already' or 'ended'" },
               { "index": 3, "clientEventId": "3-000145", "status": "rejected", "error": "studentId does not exist" } ] }
```
Remove `created` and `duplicate` events from the queue; drop (and log) `rejected` ones – they will never succeed unchanged.
If the database fails part-way, the answer is `500` with `{ "error": …, "results": [ …the events handled so far… ] }`: remove those that were handled and send the rest again later.

## Try it without hardware
Node (from `Backend/`):
```
BASE_URL=https://your-backend DEVICE_ID=3 DEVICE_KEY=<key> node tools/device-simulator.js
```
Python (from `device_client/`): `python simulator.py --url https://your-backend --device-id 3 --key <key>`.
On Windows PowerShell set the variables first: `$env:BASE_URL="https://your-backend"; $env:DEVICE_ID="3"; $env:DEVICE_KEY="<key>"`.

## Quick checks with curl
```
BASE=https://your-backend
KEY=<device key>
curl -H "X-Device-Key: $KEY" $BASE/api/devices/3/config
curl -H "X-Device-Key: $KEY" -H "Content-Type: application/json" -d '{"deviceId":3,"decision":"granted","studentId":17,"clientEventId":"3-1"}' $BASE/api/access-events
```
