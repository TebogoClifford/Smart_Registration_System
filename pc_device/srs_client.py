"""srs_client.py - the PC program's connection to the Smart Registration System backend.

Import this from your face-recognition program. It wraps the device API described in
Backend/DEVICE_API.md, so the PC program behaves exactly like the ESP32-CAM would:

    client = SrsClient("https://smart-registration-system.onrender.com", device_id=3, device_key="...")
    client.wait_until_up()                      # Render's free tier can take 30-60 s to wake up
    cfg = client.config()
    for s in client.pending_enrollments():      # students an invigilator started on the web console
        ...capture the face and compute the embedding here...
        client.report_enrollment(s["studentId"], ok=True)
    client.send_event("granted", student_id=17)

Install the one dependency with:   pip install requests
"""
import itertools
import time

try:
    import requests
except ImportError:   # every call then fails with SrsError, so a door program stays OFFLINE instead of crashing
    requests = None

# Trust the same certificates as Windows and the browser. Without this Python only trusts its own
# list, and on a network or antivirus that inspects HTTPS every request fails with an SSL error
# even though the web console opens fine in the browser.
try:
    import truststore
    truststore.inject_into_ssl()
except Exception:  # noqa: BLE001 - not installed (or Python < 3.10): Python's own list is used
    pass

NO_REQUESTS = "the 'requests' package is not installed (pip install requests)"


def explain(err):
    """A network error from requests in plain words, with what to check."""
    text = str(err)
    if isinstance(err, requests.exceptions.SSLError):
        return ("the secure (HTTPS) connection was refused: certificate not trusted. A school/work network or an "
                "antivirus that scans HTTPS does this; pip install truststore (done at start-up) fixes it on "
                f"Python 3.10+ ({text[:160]})")
    if isinstance(err, requests.exceptions.ProxyError):
        return f"the proxy server refused the connection: check the Windows proxy settings ({text[:160]})"
    if isinstance(err, requests.exceptions.Timeout):
        return ("no answer in time: the free Render server takes up to a minute to wake up, "
                f"it keeps trying ({text[:120]})")
    if isinstance(err, requests.exceptions.InvalidURL) or isinstance(err, requests.exceptions.MissingSchema):
        return f"the url in config.ini is not a valid address ({text[:160]})"
    if "getaddrinfo" in text or "NameResolution" in text or "Name or service not known" in text:
        return "the server name cannot be found: no internet on this PC, or a typing mistake in url in config.ini"
    if "refused" in text.lower():
        return ("nothing answers at that address: check url in config.ini (http://localhost:3000 only works "
                "while the backend runs on this PC)")
    return text[:240]


class SrsError(Exception):
    """The backend refused a request (a 4xx answer, or a 5xx that kept failing)."""

    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


class SrsClient:
    def __init__(self, base_url, device_id, device_key, timeout=60, retries=3):
        self.base = base_url.rstrip("/")
        self.device_id = int(device_id)
        self.timeout = timeout          # long, because the free Render tier wakes up slowly
        self.retries = retries          # extra tries for network errors and 5xx answers
        self.http = requests.Session() if requests else None
        if self.http:
            self.http.headers["X-Device-Key"] = device_key
        self._counter = itertools.count(1)

    # ---------- low level ----------
    def _request(self, method, path, **kwargs):
        """Send a request. 4xx = our mistake, raise at once. Network error / 5xx = wait and retry."""
        if self.http is None:
            raise SrsError(f"{method} {path}: {NO_REQUESTS}")
        last = None
        for attempt in range(self.retries + 1):
            try:
                res = self.http.request(method, self.base + path, timeout=self.timeout, **kwargs)
            except requests.RequestException as err:
                last = SrsError(f"cannot reach {self.base}: {explain(err)}")
            else:
                if res.status_code < 400:
                    return res.json() if res.content else None
                try:
                    message = res.json().get("error", res.text)
                except ValueError:
                    message = res.text
                last = SrsError(f"{method} {path}: {res.status_code} {message}", res.status_code)
                if res.status_code < 500:
                    raise last
            if attempt < self.retries:
                time.sleep(2 ** attempt)   # 1 s, 2 s, 4 s ...
        raise last

    def wait_until_up(self, max_wait=120):
        """Call GET /health until the backend answers (it may be waking up). Returns True when ready."""
        if requests is None:
            raise SrsError(NO_REQUESTS)
        deadline, why = time.time() + max_wait, "no answer"
        while time.time() < deadline:
            try:
                res = requests.get(self.base + "/health", timeout=15)
                if res.ok and res.json().get("status") == "ok":
                    return True
                why = f"{self.base}/health answered {res.status_code}: is url in config.ini the SRS backend?"
            except ValueError:
                why = f"{self.base}/health did not answer like the SRS backend: check url in config.ini"
            except (requests.exceptions.SSLError, requests.exceptions.InvalidURL,
                    requests.exceptions.MissingSchema) as err:
                raise SrsError(f"cannot reach {self.base}: {explain(err)}")   # waiting will not fix these
            except requests.RequestException as err:
                why = explain(err)
            time.sleep(3)
        raise SrsError(f"backend did not answer within {max_wait} s. Last problem: {why}")

    # ---------- device endpoints ----------
    def config(self):
        return self._request("GET", f"/api/devices/{self.device_id}/config")

    def heartbeat(self):
        """Also counts as 'device online' on the web console. Call it every heartbeatIntervalSeconds."""
        return self._request("POST", "/api/devices/heartbeat", json={"deviceId": self.device_id})

    def pending_enrollments(self):
        """Students an invigilator asked this device to capture: [{studentId, studentNumber, name}]."""
        return self._request("GET", f"/api/devices/{self.device_id}/pending-enrollments")

    def roster(self):
        """Students enrolled on this device. Delete any stored face whose studentId is not listed."""
        return self._request("GET", f"/api/devices/{self.device_id}/roster")

    def session(self, date=None, slot=None):
        """Who may enter now. Optional date 'YYYY-MM-DD' and slot '09:00' / '13:00'."""
        params = {k: v for k, v in (("date", date), ("slot", slot)) if v}
        return self._request("GET", f"/api/devices/{self.device_id}/session", params=params)

    # ---------- enrolment ----------
    def upload_enrollment_image(self, student_id, jpeg_bytes):
        """Optional: store one photo so the student can be re-enrolled later (max 1 MB)."""
        return self._request("PUT", f"/api/students/{student_id}/enrollment-image",
                             data=jpeg_bytes, headers={"Content-Type": "image/jpeg"})

    def report_enrollment(self, student_id, ok):
        """Tell the web console how the capture went. The Enrolment page is waiting for exactly this."""
        return self._request("PUT", f"/api/students/{student_id}/enrollment",
                             json={"status": "enrolled" if ok else "failed"})

    # ---------- access events ----------
    def new_event_id(self):
        """Unique per device, even after a restart (time + counter), at most 64 characters."""
        return f"{self.device_id}-{int(time.time() * 1000)}-{next(self._counter)}"

    def make_event(self, decision, student_id=None, seconds_ago=None, client_event_id=None):
        """Build one event dict. decision is 'granted', 'denied' or 'error'."""
        event = {"decision": decision, "clientEventId": client_event_id or self.new_event_id()}
        if student_id is not None:
            event["studentId"] = student_id
        if seconds_ago is not None:
            event["secondsAgo"] = seconds_ago
        return event

    def send_event(self, decision, student_id=None, seconds_ago=None, client_event_id=None):
        """Upload one decision. Safe to retry: the same clientEventId is never stored twice."""
        body = {"deviceId": self.device_id,
                **self.make_event(decision, student_id, seconds_ago, client_event_id)}
        return self._request("POST", "/api/access-events", json=body)

    def send_batch(self, events):
        """Upload up to 100 queued events. Returns the per-event results list."""
        out = self._request("POST", "/api/access-events/batch",
                            json={"deviceId": self.device_id, "events": events})
        return out["results"]
