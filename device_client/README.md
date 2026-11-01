# Device client (Python)

The PC door program (webcam + optional Arduino door unit) talks to the backend through the device API, the same one an ESP32-CAM would use. The backend cannot call the PC, because the PC sits behind a router. So the PC only makes **outbound** calls, and the web console only talks to the backend:

```
Web console                   Backend (Render)               PC program (this client)
"Start enrolment"         ->  saves a 'pending' student  <-  polls pending-enrollments every few seconds
Enrolment page polls      ->  status becomes 'enrolled'  <-  PUT /students/:id/enrollment {"status": "enrolled"}
Dashboard polls           ->  access events appear       <-  POST /access-events/batch (queued on disk, sent every second)
```

**How to read it:** each row is one step. The left column is what a person sees on the web console, the middle what the backend stores, the right what the PC sends. The arrows point at the backend because both sides only ever ask it; it never calls them.

* `srs_client.py` – import this in a face-recognition program. Handles the device key, long timeouts (Render wakes up slowly), retries on network errors and 5xx answers, and duplicate-proof event uploads (`send_batch`, or `send_event` for a single decision).
* `simulator.py` – runs the whole device flow with no camera, to prove the web console works with Python.
* The real webcam program is [`../pc_device/srs_pc_app.py`](../pc_device/README.md).

## Try it (no hardware)

```
pip install requests
python simulator.py --url http://localhost:3000 --device-id 1 --key <key from the device page in the web console>
```

Start an enrolment on the web console's **Enrolment** page first, then run the simulator with `--watch`: the page changes from "Capturing..." to "Enrolled".

The full endpoint list and rules are in [`../Backend/DEVICE_API.md`](../Backend/DEVICE_API.md).
