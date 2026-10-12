# Device API (ESP32-CAM ⇄ backend)

Plain HTTP(S) with JSON. The backend cannot call the device (it sits behind a router), so the device **polls**.

* **Base URL:** your Render address, e.g. `https://smart-registration-system.onrender.com`. Render only serves HTTPS, so the ESP32 must use TLS (`esp_http_client` with the certificate bundle).
* **Cold start:** the free Render tier sleeps. The first call after a quiet period can take 30–60 s. Use a 60 s timeout, and call `GET /health` at boot until it answers `{"status":"ok"}`.
* **Identity:** every device call sends `X-Device-Key: <key>`. The id and key are shown (admin only) on the device's page in the web console. Wrong key → `401`, unknown device → `404`. Any successful call also counts as a heartbeat.
* **Errors:** always JSON `{ "error": "message" }`. `4xx` = fix the request, do not retry. `5xx` or no answer = retry later.

## Startup sequence
1. `GET /health` until `ok`.
2. `GET /api/devices/{id}/config` – read settings.
3. `GET /api/devices/{id}/session` – load who may enter now.
4. Loop: heartbeat / poll enrollments (every `enrollmentPollSeconds`), refresh the session every few minutes and at 09:00 / 12:00.

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
Students an invigilator asked this device to capture (not older than 10 min). `[]` when none.
```json
[ { "studentId": 17, "studentNumber": "220123456", "name": "Thabo M." } ]
```

### Enrollment flow
1. Poll `pending-enrollments`. For each student: tell the invigilator / show on the device, wait until the student is at `captureDistanceCm`, capture and compute the embedding. Embeddings stay on the device.
2. Optional: `PUT /api/students/{studentId}/enrollment-image` with header `Content-Type: image/jpeg`, the JPEG as the raw body (max 1 MB). Stored only so the student can be re-enrolled without the camera. → `204`.
3. Report the result: `PUT /api/students/{studentId}/enrollment` with `{ "status": "enrolled" }` or `{ "status": "failed" }` → `200`. A failed student can be retried from the web console (Re-enroll).

### GET /api/devices/{id}/session[?date=YYYY-MM-DD&slot=09:00]
Who may enter this device's venue **now**. Without parameters the server uses the current session (before 12:00 → `09:00`, otherwise `13:00`, South African time).
```json
{ "venueId": 2, "date": "2026-10-12", "slot": "09:00", "serverTime": "…",
  "students": [ { "studentId": 17, "studentNumber": "220123456", "name": "Thabo M.",
                  "seatNumber": 4, "moduleCode": "PRG101", "onThisDevice": true } ] }
```
**Rule:** a face that matches nobody in `students`, or a student with `onThisDevice: false` (face enrolled on another device), is **denied**. Show `seatNumber` on success.

### GET /api/devices/{id}/roster
Students enrolled on this device (all sessions). Delete any stored face whose `studentId` is no longer listed.
`[ { "studentId": 17, "studentNumber": "220123456", "name": "Thabo M." } ]`

### POST /api/access-events
One decision. Body:
```json
{ "deviceId": 3, "decision": "granted", "studentId": 17, "clientEventId": "3-000142", "secondsAgo": 12 }
```
* `decision`: `granted` | `denied` | `error` (error = capture/match failed). `studentId` may be omitted for an unknown face.
* `clientEventId` (max 64 chars): unique per device, e.g. `deviceId-counter`. If an upload is repeated after a WiFi drop the server answers `200` with the original event instead of storing a second one. `201` = created.
* When the event happened: `timestamp` (ISO 8601, only if the device clock is set) **or** `secondsAgo` (no clock yet) **or** neither (= now).

### POST /api/access-events/batch
Upload a queue after being offline. Body `{ "deviceId": 3, "events": [ {…same fields…}, … ] }` (max 100). **`clientEventId` is required for every event in a batch.** The answer is always `200`, one result per event, so one bad event never blocks the rest.
```json
{ "results": [ { "index": 0, "clientEventId": "3-000142", "status": "created", "id": 91 },
               { "index": 1, "clientEventId": "3-000143", "status": "duplicate", "id": 77 },
               { "index": 2, "clientEventId": "3-000144", "status": "rejected", "error": "decision must be 'granted', 'denied' or 'error'" } ] }
```
Remove `created` and `duplicate` events from the queue; fix or drop `rejected` ones. 

## Try it without hardware
```
cd Backend
BASE_URL=https://your-backend DEVICE_ID=3 DEVICE_KEY=<key> node tools/device-simulator.js
```
(see the top of `tools/device-simulator.js` for the options).

## Quick checks with curl
```
curl -H "X-Device-Key: $KEY" $BASE/api/devices/3/config
curl -H "X-Device-Key: $KEY" -H "Content-Type: application/json" -d '{"deviceId":3,"decision":"granted","studentId":17,"clientEventId":"3-1"}' $BASE/api/access-events
```
