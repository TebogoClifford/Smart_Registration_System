# PC device client (Python)

The PC program (webcam + Arduino Mega) talks to the backend exactly like the ESP32-CAM would. The backend cannot call the PC, because it sits behind a router. So the PC only makes **outbound** calls, and the web console only talks to the backend:

```
Web console  ->  Backend (Render)  <-  PC program (this client)
 "Start enrollment"   saves a 'pending' student    polls pending-enrollments every few seconds
 Enroll page polls    status becomes enrolled      PUT /students/:id/enrollment  { "status": "enrolled" }
 Dashboard polls      events appear                POST /access-events  (or /batch when offline)
```

* `srs_client.py` – import this in your face-recognition program. Handles the device key, long timeouts (Render wakes up slowly), retries on network errors and 5xx answers, and duplicate-proof event uploads.
* `simulator.py` – runs the whole device flow with no camera, to prove the console works with Python.

## Try it (no hardware)

```
pip install requests
python simulator.py --url http://localhost:3000 --device-id 1 --key <key from the device page in the web console>
```

Start an enrollment on the web console's **Enroll** page first, then run the simulator with `--watch`: the page flips from "Capturing…" to "Enrolled".

The full endpoint list and rules are in [`../Backend/DEVICE_API.md`](../Backend/DEVICE_API.md).
