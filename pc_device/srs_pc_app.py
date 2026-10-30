"""srs_pc_app.py - the Smart Registration System door program for a PC with a USB webcam.

It plays the ESP32-CAM's part (see Backend/DEVICE_API.md):
  * ENROL  - when an invigilator presses "Start enrollment" on the web console, this program sees
             the student in pending-enrollments, captures their face automatically, keeps the
             embedding on this PC and reports "enrolled" (or "failed") back to the console.
  * VERIFY - otherwise it watches the door: a face that matches a student seated in this venue's
             current exam session is GRANTED (seat number shown), anything else is DENIED.
             Every decision is sent to the backend and appears on the dashboard.
  * OFFLINE - decisions are queued on disk (data/event_queue.json) and uploaded when the
             network is back; the server ignores duplicates.
  * ARDUINO (optional) - with --serial COM3 it writes 'G' (granted) or 'D' (denied) + newline.

Run:
  pip install -r requirements.txt
  python download_models.py                       (once)
  python srs_pc_app.py --url http://localhost:3000 --device-id 1 --key <device key>
  python srs_pc_app.py --check ...                (test the connection only, no camera)

Settings can also come from config.ini next to this file (see config.example.ini) or from the
environment variables BASE_URL, DEVICE_ID, DEVICE_KEY, CAMERA_INDEX, SERIAL_PORT.

Keys in the camera window:  Q / Esc = quit,  S = skip (fail) the current enrolment.
"""
import argparse
import configparser
import json
import os
import queue
import sys
import threading
import time
from pathlib import Path

import cv2

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "device_client"))
from srs_client import SrsClient, SrsError  # noqa: E402
from face_engine import FaceEngine, FaceStore  # noqa: E402

DATA = HERE / "data"
QUEUE_FILE = DATA / "event_queue.json"
WINDOW = "SRS Door"

ENROL_SAMPLES = 5            # embeddings averaged per enrolment
ENROL_SAMPLE_GAP = 0.25      # seconds between samples
ENROL_TIMEOUT = 60           # seconds before an enrolment is reported as failed
VERIFY_CONFIRM = 3           # same answer this many frames in a row before deciding
SHOW_RESULT_SECONDS = 3
SAME_PERSON_COOLDOWN = 15    # do not log the same student twice within this many seconds
SESSION_REFRESH = 120        # seconds
ROSTER_REFRESH = 300


def log(*args):
    print(time.strftime("%H:%M:%S"), *args, flush=True)


# ---------------------------------------------------------------- settings
def load_settings():
    ini = configparser.ConfigParser()
    ini.read(HERE / "config.ini", encoding="utf-8")
    cfg = ini["srs"] if ini.has_section("srs") else {}

    def pick(name, env, default=None):
        return os.environ.get(env) or cfg.get(name) or default

    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--url", default=pick("url", "BASE_URL", "http://localhost:3000"))
    p.add_argument("--device-id", default=pick("device_id", "DEVICE_ID"))
    p.add_argument("--key", default=pick("device_key", "DEVICE_KEY"))
    p.add_argument("--camera", default=pick("camera", "CAMERA_INDEX", "auto"),
                   help="webcam index, or 'auto' for the first one that works")
    p.add_argument("--serial", default=pick("serial_port", "SERIAL_PORT"), help="Arduino port, e.g. COM3")
    p.add_argument("--min-face", type=int, default=int(pick("min_face_px", "MIN_FACE_PX", "90")),
                   help="ignore faces narrower than this many pixels (= too far from the camera)")
    p.add_argument("--check", action="store_true", help="test the backend connection and exit (no camera)")
    a = p.parse_args()
    if not a.device_id or not a.key:
        p.error("set --device-id and --key (an administrator copies the key from the device page in the web console)")
    return a


# ---------------------------------------------------------------- network worker
class Backend(threading.Thread):
    """Does every network call off the camera thread, so the video never freezes on a slow request."""

    def __init__(self, client, store):
        super().__init__(daemon=True)
        self.client = client
        self.store = store
        self.lock = threading.Lock()
        self.tasks = queue.Queue()        # one-off jobs from the camera thread (enrolment results)
        self.online = False
        self.last_error = ""
        self.config = {}
        self.pending = []                 # [{studentId, studentNumber, name}]
        self.session = {"students": [], "slot": "", "date": ""}
        self.events = self._load_queue()
        self.unreported = set()           # enrolled here, server not told yet
        self.stop = threading.Event()

    def report_enrollment(self, student_id, ok):
        """Queue the enrolment result; until it is delivered, the roster clean-up leaves that face alone."""
        def job():
            self.client.report_enrollment(student_id, ok=ok)
            with self.lock:
                self.unreported.discard(student_id)
        if ok:
            with self.lock:
                self.unreported.add(student_id)
        self.tasks.put(job)

    # -- offline event queue (survives a restart)
    def _load_queue(self):
        try:
            return json.loads(QUEUE_FILE.read_text(encoding="utf-8"))
        except (FileNotFoundError, ValueError):
            return []

    def _save_queue(self):
        DATA.mkdir(exist_ok=True)
        tmp = QUEUE_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.events), encoding="utf-8")
        os.replace(tmp, QUEUE_FILE)

    def record(self, decision, student_id=None):
        with self.lock:
            self.events.append(self.client.make_event(decision, student_id) | {"at": time.time()})
            self._save_queue()

    def _flush_events(self):
        with self.lock:
            batch = self.events[: self.config.get("eventBatchMax", 100)]
        if not batch:
            return
        now = time.time()
        # the device clock may be off, so send how long ago it happened instead of a timestamp
        payload = [{k: v for k, v in e.items() if k != "at"} | {"secondsAgo": max(0, int(now - e["at"]))} for e in batch]
        results = self.client.send_batch(payload)
        done = {r["clientEventId"] for r in results if r["status"] in ("created", "duplicate", "rejected")}
        for r in results:
            if r["status"] == "rejected":
                log("event rejected by server:", r.get("error"))
        with self.lock:
            self.events = [e for e in self.events if e["clientEventId"] not in done]
            self._save_queue()

    # -- snapshots for the camera thread
    def snapshot(self):
        with self.lock:
            return dict(online=self.online, error=self.last_error, pending=list(self.pending),
                        session=self.session, queued=len(self.events))

    def run(self):
        last = {"hb": 0, "pend": 0, "session": 0, "roster": 0}
        slot_seen = None
        while not self.stop.is_set():
            now = time.time()
            try:
                if not self.config:
                    self.config = self.client.config()
                    log(f"connected as device {self.config['deviceId']} '{self.config['name']}' (venue {self.config['venueId']})")
                while not self.tasks.empty():
                    job = self.tasks.get_nowait()
                    try:
                        job()
                    except SrsError as err:
                        if err.status is not None and err.status < 500:
                            log("job refused:", err)          # e.g. the student was deleted meanwhile
                        else:
                            self.tasks.put(job)                 # network problem: try again later
                            raise
                if now - last["hb"] >= self.config.get("heartbeatIntervalSeconds", 30):
                    self.client.heartbeat()
                    last["hb"] = now
                if now - last["pend"] >= self.config.get("enrollmentPollSeconds", 3):
                    pending = self.client.pending_enrollments()
                    with self.lock:
                        self.pending = pending
                    last["pend"] = now
                # refresh the session regularly, and straight away when the 09:00 / 13:00 slot changes
                slot_now = "09:00" if time.localtime().tm_hour < 12 else "13:00"
                if now - last["session"] >= SESSION_REFRESH or slot_now != slot_seen:
                    session = self.client.session()
                    with self.lock:
                        self.session = session
                    slot_seen = slot_now
                    last["session"] = now
                    log(f"session {session['date']} {session['slot']}: {len(session['students'])} seated student(s)")
                if now - last["roster"] >= ROSTER_REFRESH:
                    roster = self.client.roster()
                    # a face whose "enrolled" report has not reached the server yet is not on the roster yet
                    with self.lock:
                        keep = {s["studentId"] for s in roster} | self.unreported
                    removed = self.store.keep_only(keep)
                    if removed:
                        log(f"removed {removed} face(s) no longer on this device's roster")
                    last["roster"] = now
                self._flush_events()
                with self.lock:
                    self.online, self.last_error = True, ""
            except SrsError as err:
                with self.lock:
                    self.online, self.last_error = False, str(err)
                log("backend problem:", err)
                if err.status in (401, 404):
                    log("check --device-id and --key: the server does not accept them")
                self.stop.wait(5)
                continue
            except Exception as err:  # never let the worker die silently
                with self.lock:
                    self.online, self.last_error = False, f"{type(err).__name__}: {err}"
                log("unexpected problem:", err)
                self.stop.wait(5)
                continue
            self.stop.wait(1)


# ---------------------------------------------------------------- camera helpers
def open_camera(choice):
    indexes = range(6) if str(choice).lower() == "auto" else [int(choice)]
    for i in indexes:
        cam = cv2.VideoCapture(i, cv2.CAP_DSHOW) if os.name == "nt" else cv2.VideoCapture(i)
        if cam.isOpened():
            ok, frame = cam.read()
            if ok and frame is not None:
                log(f"using camera {i} ({frame.shape[1]}x{frame.shape[0]})")
                return cam
        cam.release()
    raise SystemExit("No working camera found. Plug in the webcam or pass --camera <index>.")


def open_serial(port):
    if not port:
        return None
    try:
        import serial
        link = serial.Serial(port, 9600, timeout=0)
        log(f"Arduino on {port}")
        return link
    except Exception as err:  # the door program still works without the Arduino
        log(f"cannot open Arduino on {port}: {err} (continuing without it)")
        return None


def put_text(img, text, org, color=(255, 255, 255), scale=0.6, thick=2):
    cv2.putText(img, text, org, cv2.FONT_HERSHEY_SIMPLEX, scale, (0, 0, 0), thick + 3, cv2.LINE_AA)
    cv2.putText(img, text, org, cv2.FONT_HERSHEY_SIMPLEX, scale, color, thick, cv2.LINE_AA)


GREEN, RED, AMBER, WHITE = (60, 200, 60), (40, 40, 230), (0, 190, 255), (255, 255, 255)


# ---------------------------------------------------------------- main loop
class DoorApp:
    def __init__(self, args):
        self.args = args
        self.engine = FaceEngine()
        self.store = FaceStore(DATA / "faces")
        self.client = SrsClient(args.url, args.device_id, args.key)
        self.backend = Backend(self.client, self.store)
        self.arduino = open_serial(args.serial)
        self.enrolling = None      # {"student", "started", "samples", "last", "frame"}
        self.handled = set()       # enrolments finished here, until the server stops listing them
        self.result = None         # (text, color, until)
        self.streak = (None, 0)    # (candidate answer, how many frames in a row)
        self.recent = {}           # studentId -> time last logged
        self.face_gone_since = time.time()

    # -- enrolment
    def _finish_enrolment(self, ok):
        st = self.enrolling["student"]
        sid = st["studentId"]
        if ok:
            self.store.add(sid, st["studentNumber"], st["name"], self.enrolling["samples"])
            okj, jpg = cv2.imencode(".jpg", self.enrolling["frame"], [cv2.IMWRITE_JPEG_QUALITY, 85])
            if okj and len(jpg) < 1_000_000:
                self.backend.tasks.put(lambda: self.client.upload_enrollment_image(sid, jpg.tobytes()))
        self.backend.report_enrollment(sid, ok)
        self.handled.add(sid)
        self.result = (f"{'Enrolled' if ok else 'Enrolment failed'}: {st['name']}", GREEN if ok else RED, time.time() + SHOW_RESULT_SECONDS)
        log(("enrolled" if ok else "enrolment FAILED for"), st["studentNumber"], st["name"])
        self.enrolling = None

    def _step_enrolment(self, frame, faces, view):
        st = self.enrolling["student"]
        elapsed = time.time() - self.enrolling["started"]
        put_text(view, f"ENROLLING {st['name']} ({st['studentNumber']})", (10, 60), AMBER, 0.7)
        if elapsed > ENROL_TIMEOUT:
            return self._finish_enrolment(False)
        if len(faces) != 1:
            put_text(view, "One person only, please look at the camera" if faces else "No face found - step in front of the camera", (10, 90), AMBER)
            return
        face = faces[0]
        if face[2] < self.args.min_face:
            put_text(view, "Come closer to the camera", (10, 90), AMBER)
            return
        put_text(view, f"Hold still... {len(self.enrolling['samples'])}/{ENROL_SAMPLES}   (S = skip)", (10, 90), AMBER)
        if time.time() - self.enrolling["last"] >= ENROL_SAMPLE_GAP:
            self.enrolling["samples"].append(self.engine.embed(frame, face))
            self.enrolling["last"] = time.time()
            self.enrolling["frame"] = frame.copy()
            if len(self.enrolling["samples"]) >= ENROL_SAMPLES:
                self._finish_enrolment(True)

    # -- door decisions
    def _decide(self, frame, faces, session):
        if not faces:
            self.streak = (None, 0)
            return
        face = faces[0]
        if face[2] < self.args.min_face:
            self.streak = (None, 0)
            return
        # match against EVERY face stored here, then check the seat list, so a stranger is never
        # "closest" to a seated student just because the real match was left out of the search
        sid, sim = self.store.best_match(self.engine.embed(frame, face))
        seated = {s["studentId"]: s for s in session.get("students", [])}
        answer = sid if sid is not None else "unknown"
        cand, n = self.streak
        self.streak = (answer, n + 1) if cand == answer else (answer, 1)
        if self.streak[1] < VERIFY_CONFIRM:
            return
        self.streak = (None, 0)
        now = time.time()
        if sid is not None and now - self.recent.get(sid, 0) < SAME_PERSON_COOLDOWN:
            return
        person = self.store.people.get(sid) if sid is not None else None
        seat = seated.get(sid)
        if seat and seat.get("onThisDevice", True):
            decision, text, color = "granted", f"GRANTED  {person['name']}  -  seat {seat['seatNumber']} ({seat['moduleCode']})", GREEN
        elif person:
            decision, text, color = "denied", f"DENIED  {person['name']}  -  no seat in this session", RED
        else:
            decision, text, color = "denied", "DENIED  -  face not recognised", RED
        if sid is None and now - self.recent.get("unknown", 0) < 5:
            return
        self.recent[sid if sid is not None else "unknown"] = now
        self.backend.record(decision, sid)
        if self.arduino:
            try:
                self.arduino.write(b"G\n" if decision == "granted" else b"D\n")
            except Exception as err:
                log("Arduino write failed:", err)
        self.result = (text, color, now + SHOW_RESULT_SECONDS)
        log(decision.upper(), person["studentNumber"] if person else "-", f"similarity {sim:.2f}")

    def run(self):
        log(f"backend {self.args.url}: waiting for it to answer (Render can take ~60 s to wake)...")
        self.client.wait_until_up()
        self.backend.start()
        cam = open_camera(self.args.camera)
        cv2.namedWindow(WINDOW, cv2.WINDOW_NORMAL)
        try:
            while True:
                ok, frame = cam.read()
                if not ok or frame is None:
                    log("camera stopped sending frames")
                    break
                view = frame.copy()
                faces = self.engine.detect(frame)
                for f in faces:
                    x, y, w, h = (int(v) for v in f[:4])
                    cv2.rectangle(view, (x, y), (x + w, y + h), WHITE if w >= self.args.min_face else AMBER, 2)
                snap = self.backend.snapshot()
                self.handled &= {p["studentId"] for p in snap["pending"]}  # forget once the server agrees

                showing = self.result and time.time() < self.result[2]
                if self.enrolling is None:
                    todo = [p for p in snap["pending"] if p["studentId"] not in self.handled]
                    if todo and not showing:
                        self.enrolling = {"student": todo[0], "started": time.time(), "samples": [], "last": 0, "frame": frame}
                        log("enrolment requested:", todo[0]["studentNumber"], todo[0]["name"])
                if self.enrolling:
                    self._step_enrolment(frame, faces, view)
                elif not showing:
                    self._decide(frame, faces, snap["session"])

                # status bar
                s = snap["session"]
                status = (f"{'ONLINE' if snap['online'] else 'OFFLINE'}  |  session {s.get('date', '?')} {s.get('slot', '')}"
                          f"  |  {len(s.get('students', []))} seated  |  {len(self.store.people)} faces here  |  {snap['queued']} queued")
                put_text(view, status, (10, 25), GREEN if snap["online"] else RED, 0.55, 1)
                if not snap["online"] and snap["error"]:
                    put_text(view, snap["error"][:90], (10, view.shape[0] - 15), RED, 0.5, 1)
                if self.result and time.time() < self.result[2]:
                    put_text(view, self.result[0], (10, view.shape[0] // 2), self.result[1], 0.8, 2)

                cv2.imshow(WINDOW, view)
                key = cv2.waitKey(1) & 0xFF
                if key in (ord("q"), ord("Q"), 27):
                    break
                if key in (ord("s"), ord("S")) and self.enrolling:
                    self._finish_enrolment(False)
                if cv2.getWindowProperty(WINDOW, cv2.WND_PROP_VISIBLE) < 1:
                    break
        except KeyboardInterrupt:
            pass
        finally:
            self.backend.stop.set()
            cam.release()
            cv2.destroyAllWindows()
            if self.arduino:
                self.arduino.close()
            log(f"stopped ({len(self.backend.events)} event(s) still queued; they upload next time)")


def check(args):
    """--check: prove the URL, device id and key work, without touching the camera."""
    client = SrsClient(args.url, args.device_id, args.key)
    log("waiting for", args.url)
    client.wait_until_up()
    cfg = client.config()
    log(f"config OK: device {cfg['deviceId']} '{cfg['name']}', venue {cfg['venueId']}")
    log("heartbeat OK:", client.heartbeat()["status"])
    log(f"pending enrolments: {len(client.pending_enrollments())}")
    s = client.session()
    log(f"session {s['date']} {s['slot']}: {len(s['students'])} seated")
    log(f"roster: {len(client.roster())} student(s) enrolled on this device")
    store = FaceStore(DATA / "faces")
    log(f"faces stored on this PC: {len(store.people)}")
    FaceEngine()
    log("face models load OK. Everything is ready.")


if __name__ == "__main__":
    settings = load_settings()
    try:
        check(settings) if settings.check else DoorApp(settings).run()
    except SrsError as e:
        raise SystemExit(f"Backend refused: {e}")
