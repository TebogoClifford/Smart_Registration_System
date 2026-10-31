"""srs_pc_app.py - the Smart Registration System door program for a PC with a USB webcam.

It plays the ESP32-CAM's part (see Backend/DEVICE_API.md):
  * ENROL  - when an invigilator presses "Start enrollment" on the web console, this program sees
             the student in pending-enrollments, captures their face automatically, saves
             data/photos/<student number>.jpg and data/embeddings/<student number>.json on this PC,
             and reports "enrolled" (or "failed") and the photo back to the console.
  * RECOGNISE - off at start; the "Start recognition" button turns it on. Any enrolled student
             whose face matches is RECOGNISED (granted; their seat is shown if they have one in this
             session), an unknown face is DENIED. Every decision is sent to the backend and appears
             on the dashboard's "Recognised now" panel and access events.
  * OFFLINE - decisions are queued on disk (data/event_queue.json) and uploaded when the
             network is back; the server ignores duplicates.
  * ARDUINO (optional) - with --serial COM3 (or serial_port in config.ini) the door unit in
             arduino/srs_door decides WHEN to take the picture: it sends READY once the student
             has stood at the right distance for 1 second (AWAY if they leave), and this program
             answers 'G' (granted) or 'D' (denied) + newline for its LCD and buzzer.

The window shows the camera top-right and the program's state (connection, exam session and
seat list, enrolment progress, activity log) beside it. Pick the camera from the list under the
video; the choice is saved in config.ini.

Run:
  pip install -r requirements.txt
  python download_models.py                       (once)
  python srs_pc_app.py                            (settings from config.ini)
  python srs_pc_app.py --check                    (test the connection only, no camera)

Settings can also come from the command line or the environment variables BASE_URL, DEVICE_ID,
DEVICE_KEY, CAMERA_INDEX, SERIAL_PORT.
"""
import argparse
import configparser
import json
import os
import queue
import re
import sys
import threading
import time
import tkinter as tk
from collections import deque
from pathlib import Path
from tkinter import ttk

import cv2

# hide OpenCV's harmless warnings (empty camera slots while scanning, dnn engine notes)
try:
    cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_ERROR)
except AttributeError:
    pass

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "device_client"))
from srs_client import SrsClient, SrsError  # noqa: E402
from face_engine import FaceEngine, FaceStore  # noqa: E402

DATA = HERE / "data"
QUEUE_FILE = DATA / "event_queue.json"
CONFIG_FILE = HERE / "config.ini"

ENROL_SAMPLES = 5            # embeddings averaged per enrolment
ENROL_SAMPLE_GAP = 0.25      # seconds between samples
ENROL_TIMEOUT = 60           # seconds before an enrolment is reported as failed
VERIFY_CONFIRM = 3           # same answer this many frames in a row before deciding
SHOW_RESULT_SECONDS = 3
SAME_PERSON_COOLDOWN = 15    # do not log the same student twice within this many seconds
UNKNOWN_GONE_SECONDS = 2     # an unrecognised face is logged once, again only after it has left
GATE_SECONDS = 6             # with an Arduino: how long a READY stays valid without a decision
ALREADY_REPEAT_SECONDS = 60  # a student who is already inside is logged again at most this often
SESSION_REFRESH = 120        # seconds
ROSTER_REFRESH = 300
VIDEO_W, VIDEO_H = 320, 240  # size of the video panel (display only: recognition uses the full camera picture)

LOG = deque(maxlen=300)      # shown in the window's activity panel


def log(*args):
    line = " ".join([time.strftime("%H:%M:%S"), *map(str, args)])
    print(line, flush=True)
    LOG.append(line)


# ---------------------------------------------------------------- settings
def load_settings():
    ini = configparser.ConfigParser()
    ini.read(CONFIG_FILE, encoding="utf-8")
    cfg = ini["srs"] if ini.has_section("srs") else {}

    def pick(name, env, default=None):
        return os.environ.get(env) or cfg.get(name) or default

    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--url", default=pick("url", "BASE_URL", "http://localhost:3000"))
    p.add_argument("--device-id", default=pick("device_id", "DEVICE_ID"))
    p.add_argument("--key", default=pick("device_key", "DEVICE_KEY"))
    p.add_argument("--camera", default=pick("camera", "CAMERA_INDEX", "auto"),
                   help="webcam index, or 'auto' (prefers an external USB camera over the built-in one)")
    p.add_argument("--serial", default=pick("serial_port", "SERIAL_PORT"), help="Arduino port, e.g. COM3")
    p.add_argument("--min-face", type=int, default=int(pick("min_face_px", "MIN_FACE_PX", "90")),
                   help="ignore faces narrower than this many pixels (= too far from the camera)")
    p.add_argument("--check", action="store_true", help="test the backend connection and exit (no camera)")
    a = p.parse_args()
    if not a.device_id or not a.key:
        p.error("set --device-id and --key (an administrator copies the key from the device page in the web console)")
    return a


def save_camera_choice(index):
    """Remember the picked camera in config.ini, changing only the 'camera =' line (comments survive)."""
    if not CONFIG_FILE.exists():
        return
    text = CONFIG_FILE.read_text(encoding="utf-8")
    line = f"camera = {index}"
    text = re.sub(r"(?m)^camera\s*=.*$", line, text) if re.search(r"(?m)^camera\s*=", text) else text.rstrip() + f"\n{line}\n"
    CONFIG_FILE.write_text(text, encoding="utf-8")


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
        self.last_contact = None
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

    # -- snapshots for the other threads
    def snapshot(self):
        with self.lock:
            return dict(online=self.online, error=self.last_error, pending=list(self.pending),
                        session=self.session, queued=len(self.events), config=dict(self.config),
                        last_contact=self.last_contact)

    def run(self):
        last = {"hb": 0, "pend": 0, "session": 0, "roster": 0}
        slot_seen = None
        while not self.stop.is_set():
            now = time.time()
            try:
                if not self.config:
                    cfg = self.client.config()
                    with self.lock:
                        self.config = cfg
                    log(f"connected as device {cfg['deviceId']} '{cfg['name']}' (venue {cfg['venueId']})")
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
                    self.online, self.last_error, self.last_contact = True, "", time.time()
            except SrsError as err:
                with self.lock:
                    self.online, self.last_error = False, str(err)
                log("backend problem:", err)
                if err.status in (401, 404):
                    log(key_help(self.client.device_id))
                self.stop.wait(5)
                continue
            except Exception as err:  # never let the worker die silently
                with self.lock:
                    self.online, self.last_error = False, f"{type(err).__name__}: {err}"
                log("unexpected problem:", err)
                self.stop.wait(5)
                continue
            self.stop.wait(1)


# ---------------------------------------------------------------- cameras
def _open(index):
    return cv2.VideoCapture(index, cv2.CAP_DSHOW) if os.name == "nt" else cv2.VideoCapture(index)


def list_cameras(max_index=6, skip=None):
    """[(index, width, height)] of the cameras that deliver a frame. `skip` = an index already open."""
    found = []
    for i in range(max_index):
        if i == skip:
            found.append((i, None, None))
            continue
        cam = _open(i)
        if cam.isOpened():
            ok, frame = cam.read()
            if ok and frame is not None:
                found.append((i, frame.shape[1], frame.shape[0]))
        cam.release()
    return found


def auto_camera(cameras):
    """Built-in laptop cameras are normally index 0 and a plugged-in USB webcam comes after it,
    so 'auto' takes the highest working index."""
    return cameras[-1][0] if cameras else None


def session_key(session):
    """(date, slot) of the exam session: the server's when known, else this PC's clock (offline)."""
    if session.get("date") and session.get("slot"):
        return session["date"], session["slot"]
    return time.strftime("%Y-%m-%d"), ("09:00" if time.localtime().tm_hour < 12 else "13:00")


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


GREEN, RED, AMBER, WHITE = (60, 200, 60), (40, 40, 230), (0, 190, 255), (255, 255, 255)


# ---------------------------------------------------------------- camera + face worker
class DoorEngine(threading.Thread):
    """Reads the camera, finds faces, runs enrolments and door decisions. The window only displays
    what this thread publishes (latest frame + state), so slow face maths never freezes the GUI."""

    def __init__(self, args, backend, store, client):
        super().__init__(daemon=True)
        self.args = args
        self.backend = backend
        self.store = store
        self.client = client
        self.engine = FaceEngine()
        self.arduino = open_serial(args.serial)
        self.serial_buf = b""
        self.gate_at = 0.0             # when the Arduino last said READY (0 = nobody at the marker)
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.cameras = []              # filled by rescan()
        self.camera_index = None       # the one open now
        self.want_camera = None        # set by the window to switch
        self.frame = None              # latest annotated frame (BGR) for the window
        self.camera_error = ""
        self.enrolling = None          # {"student", "started", "samples", "last", "frame"}
        self.handled = set()           # enrolments finished here, until the server stops listing them
        self.result = None             # (decision, text, until)
        self.streak = (None, 0)        # (candidate answer, how many frames in a row)
        self.recent = {}               # studentId -> time last logged
        self.unknown_logged = False
        self.face_seen_at = 0.0
        self.skip_requested = False
        self.recognising = False       # the window's Start/Stop recognition button
        self.let_in = {}               # (date, slot) -> student ids let in here during that exam session
        self.history = deque(maxlen=50)  # (time, decision, who)

    # -- called from the window thread
    def request_camera(self, index):
        self.want_camera = index

    def request_skip(self):
        self.skip_requested = True

    def toggle_recognition(self):
        self.recognising = not self.recognising
        self.streak = (None, 0)
        self.gate_at = 0.0
        log("recognition mode", "ON" if self.recognising else "OFF")
        return self.recognising

    def rescan(self):
        cams = list_cameras(skip=self.camera_index)
        with self.lock:
            self.cameras = cams
        log("cameras found: " + (", ".join(f"#{i}" for i, _, _ in cams) or "none"))
        return cams

    def state(self):
        with self.lock:
            enrol = None
            e = self.enrolling  # read once: the camera thread may set it to None at any moment
            if e:
                enrol = dict(name=e["student"]["name"], number=e["student"]["studentNumber"],
                             samples=len(e["samples"]), hint=e.get("hint", ""),
                             seconds_left=max(0, int(ENROL_TIMEOUT - (time.time() - e["started"]))))
            return dict(frame=self.frame, camera=self.camera_index, cameras=list(self.cameras),
                        arduino=bool(self.arduino), gate_open=self._gate_open(), recognising=self.recognising,
                        camera_error=self.camera_error, enrolling=enrol,
                        result=self.result if self.result and time.time() < self.result[2] else None,
                        faces_stored=len(self.store.people), history=list(self.history))

    # -- enrolment
    def _finish_enrolment(self, ok):
        st = self.enrolling["student"]
        sid = st["studentId"]
        if ok:
            # two files on this PC: data/photos/<number>.jpg and data/embeddings/<number>.json
            okj, jpg = cv2.imencode(".jpg", self.enrolling["frame"], [cv2.IMWRITE_JPEG_QUALITY, 85])
            photo = jpg.tobytes() if okj else None
            self.store.add(sid, st["studentNumber"], st["name"], self.enrolling["samples"], photo_jpg=photo)
            log(f"saved {self.store.photo_path(st['studentNumber']).name} and the embedding for {st['studentNumber']}")
            if photo and len(photo) < 1_000_000:
                self.backend.tasks.put(lambda: self.client.upload_enrollment_image(sid, photo))
        self.backend.report_enrollment(sid, ok)
        self.handled.add(sid)
        self.result = ("granted" if ok else "denied", f"{'Enrolled' if ok else 'Enrolment failed'}: {st['name']}",
                       time.time() + SHOW_RESULT_SECONDS)
        log(("enrolled" if ok else "enrolment FAILED for"), st["studentNumber"], st["name"])
        self.enrolling = None

    def _step_enrolment(self, frame, faces):
        e = self.enrolling
        if self.skip_requested or time.time() - e["started"] > ENROL_TIMEOUT:
            self.skip_requested = False
            return self._finish_enrolment(False)
        if len(faces) != 1:
            e["hint"] = "One person only, please look at the camera" if faces else "No face found: step in front of the camera"
            return
        face = faces[0]
        if face[2] < self.args.min_face:
            e["hint"] = "Come closer to the camera"
            return
        e["hint"] = "Hold still..."
        if time.time() - e["last"] >= ENROL_SAMPLE_GAP:
            e["samples"].append(self.engine.embed(frame, face))
            e["last"] = time.time()
            e["frame"] = frame.copy()
            if len(e["samples"]) >= ENROL_SAMPLES:
                self._finish_enrolment(True)

    # -- Arduino distance gate
    def _gate_open(self):
        """True while the Arduino says a student has held the right distance (always True without one)."""
        return not self.arduino or time.time() - self.gate_at < GATE_SECONDS

    def _read_arduino(self):
        if not self.arduino:
            return
        try:
            self.serial_buf += self.arduino.read(256)
        except Exception as err:
            log("Arduino read failed:", err, "(continuing without it)")
            self.arduino = None
            return
        *lines, self.serial_buf = self.serial_buf.split(b"\n")
        for raw in lines:
            msg = raw.strip().decode("ascii", "ignore")
            if msg == "READY":
                self.gate_at = time.time()
                self.streak = (None, 0)
            elif msg == "AWAY":
                self.gate_at = 0.0
            elif msg == "HELLO":
                log("Arduino door unit connected")

    # -- door decisions
    def _decide(self, frame, faces, session):
        """Returns the label to draw on the biggest face."""
        now = time.time()
        if not self._gate_open():
            self.streak = (None, 0)
            return "stand at the marker" if faces else None
        if not faces or faces[0][2] < self.args.min_face:
            self.streak = (None, 0)
            if now - self.face_seen_at > UNKNOWN_GONE_SECONDS:
                self.unknown_logged = False
            return None
        self.face_seen_at = now
        face = faces[0]
        # match against EVERY face stored here, then check the seat list, so a stranger is never
        # "closest" to a seated student just because the real match was left out of the search
        sid, sim = self.store.best_match(self.engine.embed(frame, face))
        person = self.store.people.get(sid) if sid is not None else None
        # a student is let in once per exam session: who is in = let in here + what the server reports
        let_in = self.let_in.setdefault(session_key(session), set())
        inside = sid is not None and (sid in let_in or sid in session.get("alreadyInside", []))
        label = (f"{person['name']} · already inside" if inside else person["name"]) if person else "not recognised"
        answer = sid if sid is not None else "unknown"
        cand, n = self.streak
        self.streak = (answer, n + 1) if cand == answer else (answer, 1)
        if self.streak[1] < VERIFY_CONFIRM:
            return label
        self.streak = (None, 0)
        # With the Arduino every scan is a deliberate 1-second hold at the marker (and the student must
        # step away before the next), so each one gets an answer. Without it, repeats are suppressed.
        if self.arduino:
            self.gate_at = 0.0
        elif sid is None:
            if self.unknown_logged:
                return label
            self.unknown_logged = True
        elif now - self.recent.get(sid, 0) < (ALREADY_REPEAT_SECONDS if inside else SAME_PERSON_COOLDOWN):
            return label
        # every enrolled student is recognised and let through ONCE per session; the web console shows
        # whether they have a seat in the exam running now
        seat = {s["studentId"]: s for s in session.get("students", [])}.get(sid)
        if person and inside:
            decision, text = "already", f"ALREADY INSIDE  {person['name']}\n{person['studentNumber']} · let in earlier this session"
        elif person:
            where = f"seat {seat['seatNumber']} · {seat['moduleCode']}" if seat else "no exam seat in this session"
            decision, text = "granted", f"RECOGNISED  {person['name']}\n{person['studentNumber']} · {where}"
            let_in.add(sid)
        else:
            decision, text = "denied", "NOT RECOGNISED\nface is not enrolled"
        if sid is not None:
            self.recent[sid] = now
        self.backend.record(decision, sid)
        if self.arduino:
            try:
                self.arduino.write({"granted": b"G\n", "already": b"A\n"}.get(decision, b"D\n"))
            except Exception as err:
                log("Arduino write failed:", err)
        self.result = (decision, text, now + SHOW_RESULT_SECONDS)
        who = f"{person['studentNumber']} {person['name']}" if person else "unknown face"
        self.history.appendleft((time.strftime("%H:%M:%S"), decision, who))
        log(decision.upper(), who, f"similarity {sim:.2f}")
        return label

    def _switch(self, cam, index):
        if cam is not None:
            cam.release()
        new = _open(index)
        ok = new.isOpened() and new.read()[0]
        with self.lock:
            if ok:
                self.camera_index, self.camera_error = index, ""
            else:
                self.camera_error = f"camera #{index} did not deliver a picture"
        if ok:
            log(f"using camera #{index}")
            return new
        new.release()
        log(f"camera #{index} failed")
        return None

    def run(self):
        cams = self.rescan()
        choice = self.args.camera
        start = auto_camera(cams) if str(choice).lower() == "auto" else int(choice)
        if start is None:
            with self.lock:
                self.camera_error = "No camera found. Plug in the webcam and press Rescan."
        cam = self._switch(None, start) if start is not None else None
        while not self.stop.is_set():
            if self.want_camera is not None:
                cam = self._switch(cam, self.want_camera)
                self.want_camera = None
            if cam is None:
                self.stop.wait(0.3)
                continue
            ok, frame = cam.read()
            if not ok or frame is None:
                with self.lock:
                    self.camera_error = "The camera stopped sending pictures. Pick a camera or press Rescan."
                cam.release()
                cam = None
                continue
            self._read_arduino()
            faces = self.engine.detect(frame)
            snap = self.backend.snapshot()
            self.handled &= {p["studentId"] for p in snap["pending"]}  # forget once the server agrees
            showing = self.result and time.time() < self.result[2]
            label = None
            # no lock here: face maths is slow and the window must never wait for it.
            # state() only reads whole attributes, which are swapped atomically.
            if self.enrolling is None:
                todo = [p for p in snap["pending"] if p["studentId"] not in self.handled]
                if todo and not showing:
                    self.enrolling = {"student": todo[0], "started": time.time(), "samples": [], "last": 0, "frame": frame}
                    log("enrolment requested:", todo[0]["studentNumber"], todo[0]["name"])
            if self.enrolling:
                self._step_enrolment(frame, faces)
            elif not showing and self.recognising:
                label = self._decide(frame, faces, snap["session"])
            view = frame
            for n, f in enumerate(faces):
                x, y, w, h = (int(v) for v in f[:4])
                color = WHITE if w >= self.args.min_face else AMBER
                cv2.rectangle(view, (x, y), (x + w, y + h), color, 2)
                if n == 0 and label:
                    cv2.putText(view, label, (x, max(20, y - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 4, cv2.LINE_AA)
                    cv2.putText(view, label, (x, max(20, y - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2, cv2.LINE_AA)
            with self.lock:
                self.frame = view
        if cam is not None:
            cam.release()
        if self.arduino:
            self.arduino.close()


# ---------------------------------------------------------------- window
BG, PANEL, INK, MUTED = "#f4f6f9", "#ffffff", "#1f2937", "#6b7280"
OK_BG, BAD_BG, WARN_BG, IDLE_BG = "#16a34a", "#dc2626", "#d97706", "#e5e7eb"


class DoorWindow:
    def __init__(self, args, door, backend):
        self.args, self.door, self.backend = args, door, backend
        self.root = root = tk.Tk()
        root.title("SRS Door")
        root.configure(bg=BG)
        root.geometry("880x660")   # the layout needs about 830x650; resize freely
        root.minsize(820, 620)
        style = ttk.Style(root)
        style.theme_use("clam")
        style.configure(".", background=BG, foreground=INK, font=("Segoe UI", 10))
        style.configure("Panel.TLabelframe", background=PANEL, bordercolor="#d1d5db")
        style.configure("Panel.TLabelframe.Label", background=BG, foreground=INK, font=("Segoe UI Semibold", 10))
        style.configure("P.TLabel", background=PANEL)
        style.configure("Muted.TLabel", background=PANEL, foreground=MUTED)
        style.configure("Treeview", rowheight=22, font=("Segoe UI", 9))
        style.configure("Treeview.Heading", font=("Segoe UI Semibold", 9))
        style.configure("Enrol.Horizontal.TProgressbar", troughcolor=IDLE_BG, background=OK_BG)

        root.columnconfigure(0, weight=1)
        root.rowconfigure(1, weight=1)

        # header
        head = tk.Frame(root, bg=INK)
        head.grid(row=0, column=0, columnspan=2, sticky="ew")
        tk.Label(head, text="Smart Registration System · Door", bg=INK, fg="white",
                 font=("Segoe UI Semibold", 14)).pack(side="left", padx=14, pady=10)
        self.conn = tk.Label(head, text="CONNECTING…", bg=WARN_BG, fg="white", font=("Segoe UI Semibold", 10), padx=10, pady=3)
        self.conn.pack(side="right", padx=14)
        self.clock = tk.Label(head, text="", bg=INK, fg="#cbd5e1", font=("Segoe UI", 10))
        self.clock.pack(side="right", padx=6)

        # left: information panels
        left = tk.Frame(root, bg=BG)
        left.grid(row=1, column=0, sticky="nsew", padx=(12, 6), pady=12)
        left.columnconfigure(0, weight=1)
        left.rowconfigure(2, weight=1)
        left.rowconfigure(3, weight=1)

        dev = ttk.LabelFrame(left, text="Device", style="Panel.TLabelframe", padding=10)
        dev.grid(row=0, column=0, sticky="ew", pady=(0, 8))
        dev.columnconfigure(1, weight=1)
        self.dev_vals = {}
        for r, key in enumerate(["Server", "Device", "Venue", "Last contact", "Faces on this PC", "Queued events"]):
            ttk.Label(dev, text=key, style="Muted.TLabel").grid(row=r, column=0, sticky="w", padx=(0, 12))
            v = ttk.Label(dev, text="—", style="P.TLabel")
            v.grid(row=r, column=1, sticky="w")
            self.dev_vals[key] = v

        ses = ttk.LabelFrame(left, text="Exam session", style="Panel.TLabelframe", padding=10)
        ses.grid(row=2, column=0, sticky="nsew", pady=(0, 8))
        ses.columnconfigure(0, weight=1)
        ses.rowconfigure(1, weight=1)
        self.ses_title = ttk.Label(ses, text="—", style="P.TLabel")
        self.ses_title.grid(row=0, column=0, sticky="w", pady=(0, 6))
        cols = ("seat", "number", "name", "module")
        self.seats = ttk.Treeview(ses, columns=cols, show="headings", height=6)
        for c, w in zip(cols, (50, 110, 200, 80)):
            self.seats.heading(c, text=c.capitalize())
            self.seats.column(c, width=w, anchor="w", stretch=c == "name")
        self.seats.grid(row=1, column=0, sticky="nsew")
        self._session_key = None

        act = ttk.LabelFrame(left, text="Activity", style="Panel.TLabelframe", padding=10)
        act.grid(row=3, column=0, sticky="nsew")
        act.columnconfigure(0, weight=1)
        act.rowconfigure(0, weight=1)
        self.log_box = tk.Listbox(act, font=("Consolas", 9), bg=PANEL, fg=INK, borderwidth=0, highlightthickness=0, activestyle="none", height=7)
        self.log_box.grid(row=0, column=0, sticky="nsew")
        sb = ttk.Scrollbar(act, command=self.log_box.yview)
        sb.grid(row=0, column=1, sticky="ns")
        self.log_box.config(yscrollcommand=sb.set)
        self._log_len = 0

        # right: video on top, then the decision banner and the camera picker
        right = tk.Frame(root, bg=BG)
        right.grid(row=1, column=1, sticky="n", padx=(6, 12), pady=12)
        # a blank image keeps the panel VIDEO_W x VIDEO_H pixels even while only text is shown
        self._blank = tk.PhotoImage(width=VIDEO_W, height=VIDEO_H)
        self.video = tk.Label(right, bg="#111827", fg="#9ca3af", image=self._blank, borderwidth=0,
                              text="Starting camera…", font=("Segoe UI", 11), compound="center", wraplength=VIDEO_W - 30)
        self.video.grid(row=0, column=0, sticky="n")
        self.banner = tk.Label(right, text="Ready", bg=IDLE_BG, fg=INK, font=("Segoe UI Semibold", 12),
                               height=3, justify="center", wraplength=VIDEO_W - 10)
        self.banner.grid(row=1, column=0, sticky="ew", pady=(8, 8))
        # recognition is off at start: enrolment always works, door decisions only while this is on
        self.recog_btn = tk.Button(right, text="▶  Start recognition", command=self._toggle_recognition,
                                   bg=OK_BG, fg="white", activebackground=OK_BG, activeforeground="white",
                                   font=("Segoe UI Semibold", 11), relief="flat", cursor="hand2", pady=4)
        self.recog_btn.grid(row=2, column=0, sticky="ew", pady=(0, 8))
        camrow = tk.Frame(right, bg=BG)
        camrow.grid(row=3, column=0, sticky="ew")
        tk.Label(camrow, text="Camera", bg=BG, fg=INK).pack(side="left")
        self.cam_pick = ttk.Combobox(camrow, state="readonly", width=22)
        self.cam_pick.pack(side="left", padx=8)
        self.cam_pick.bind("<<ComboboxSelected>>", self._pick_camera)
        self.rescan_btn = ttk.Button(camrow, text="Rescan", command=self._rescan)
        self.rescan_btn.pack(side="left")

        # enrolment, under the camera controls (keeps the window short)
        enr = ttk.LabelFrame(right, text="Enrolment", style="Panel.TLabelframe", padding=10)
        enr.grid(row=4, column=0, sticky="ew", pady=(10, 0))
        enr.columnconfigure(0, weight=1)
        self.enr_title = ttk.Label(enr, text="Waiting for the web console…", style="P.TLabel",
                                   font=("Segoe UI Semibold", 10), wraplength=VIDEO_W - 30)
        self.enr_title.grid(row=0, column=0, columnspan=2, sticky="w")
        self.enr_hint = ttk.Label(enr, text="Start an enrolment on the web console's Enroll page.", style="Muted.TLabel",
                                  wraplength=VIDEO_W - 30)
        self.enr_hint.grid(row=1, column=0, columnspan=2, sticky="w", pady=(2, 6))
        self.enr_bar = ttk.Progressbar(enr, maximum=ENROL_SAMPLES, style="Enrol.Horizontal.TProgressbar")
        self.enr_bar.grid(row=2, column=0, sticky="ew")
        self.skip_btn = ttk.Button(enr, text="Skip", command=door.request_skip, state="disabled")
        self.skip_btn.grid(row=2, column=1, padx=(8, 0))
        self._cams_shown = None

        self._photo = None
        self._tick_n = 0
        root.protocol("WM_DELETE_WINDOW", self.close)
        root.bind("<Escape>", lambda _e: self.close())

    # -- camera picker
    def _pick_camera(self, _event=None):
        i = self.cam_pick.current()
        cams = self.door.state()["cameras"]
        if 0 <= i < len(cams):
            index = cams[i][0]
            self.door.request_camera(index)
            save_camera_choice(index)

    def _rescan(self):
        self.rescan_btn.config(state="disabled", text="Scanning…")

        def work():
            self.door.rescan()
            self.root.after(0, lambda: self.rescan_btn.config(state="normal", text="Rescan"))
        threading.Thread(target=work, daemon=True).start()

    # -- refresh
    def _show_frame(self, frame, error):
        if frame is None:
            self.video.config(image=self._blank, text=error or "Starting camera…")
            self._photo = None
            return
        h, w = frame.shape[:2]
        scale = min(VIDEO_W / w, VIDEO_H / h)
        if scale != 1:
            frame = cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        h, w = rgb.shape[:2]
        # Tk reads PPM natively, so no Pillow is needed
        self._photo = tk.PhotoImage(width=w, height=h, data=b"P6 %d %d 255 " % (w, h) + rgb.tobytes(), format="PPM")
        self.video.config(image=self._photo, text="")

    def _refresh_panels(self, st, snap):
        cfg = snap["config"]
        self.clock.config(text=time.strftime("%a %d %b  %H:%M:%S"))
        if snap["online"]:
            self.conn.config(text="ONLINE", bg=OK_BG)
        elif snap["error"]:
            self.conn.config(text="OFFLINE", bg=BAD_BG)
        self.dev_vals["Server"].config(text=self.args.url)
        self.dev_vals["Device"].config(text=f"#{cfg['deviceId']}  {cfg['name']}" if cfg else f"#{self.args.device_id}")
        self.dev_vals["Venue"].config(text=f"#{cfg['venueId']}" if cfg else "—")
        lc = snap["last_contact"]
        self.dev_vals["Last contact"].config(text=f"{int(time.time() - lc)} s ago" if lc else (snap["error"][:60] or "—"))
        self.dev_vals["Faces on this PC"].config(text=str(st["faces_stored"]))
        self.dev_vals["Queued events"].config(text=str(snap["queued"]))

        e = st["enrolling"]
        if e:
            self.enr_title.config(text=f"Enrolling {e['name']} ({e['number']})")
            self.enr_hint.config(text=f"{e['hint'] or 'Look at the camera'}   ·   {e['seconds_left']} s left")
            self.enr_bar.config(value=e["samples"])
            self.skip_btn.config(state="normal")
        else:
            waiting = len(snap["pending"])
            self.enr_title.config(text=f"{waiting} enrolment(s) waiting" if waiting else "Waiting for the web console…")
            self.enr_hint.config(text="Start an enrolment on the web console's Enroll page.")
            self.enr_bar.config(value=0)
            self.skip_btn.config(state="disabled")

        s = snap["session"]
        key = (s.get("date"), s.get("slot"), tuple(x["studentId"] for x in s.get("students", [])))
        if key != self._session_key:
            self._session_key = key
            students = s.get("students", [])
            self.ses_title.config(text=f"{s.get('date') or '—'}  {s.get('slot') or ''}   ·   {len(students)} seated"
                                  + ("" if students else "   (no exam booked in this venue now)"))
            self.seats.delete(*self.seats.get_children())
            for x in sorted(students, key=lambda x: x["seatNumber"]):
                self.seats.insert("", "end", values=(x["seatNumber"], x["studentNumber"], x["name"], x["moduleCode"]))

        cams = st["cameras"]
        if (cams, st["camera"]) != self._cams_shown:
            self._cams_shown = (cams, st["camera"])
            labels = [f"#{i}" + (f"  {w}x{h}" if w else "  (in use)") + ("  · built-in?" if i == 0 and len(cams) > 1 else "")
                      for i, w, h in cams]
            self.cam_pick.config(values=labels)
            idx = next((n for n, c in enumerate(cams) if c[0] == st["camera"]), -1)
            if idx >= 0:
                self.cam_pick.current(idx)
            else:
                self.cam_pick.set("no camera" if not cams else "pick a camera")

        if len(LOG) != self._log_len or (LOG and self.log_box.get(0) != LOG[-1]):
            self.log_box.delete(0, "end")
            for line in reversed(LOG):
                self.log_box.insert("end", line)
            self._log_len = len(LOG)

    def _toggle_recognition(self):
        on = self.door.toggle_recognition()
        self.recog_btn.config(text="■  Stop recognition" if on else "▶  Start recognition",
                              bg=BAD_BG if on else OK_BG, activebackground=BAD_BG if on else OK_BG)

    def _refresh_banner(self, st):
        r = st["result"]
        if r:
            self.banner.config(text=r[1], bg={"granted": OK_BG, "already": WARN_BG}.get(r[0], BAD_BG), fg="white")
        elif st["enrolling"]:
            self.banner.config(text=f"Enrolling {st['enrolling']['name']}", bg=WARN_BG, fg="white")
        elif not st["recognising"]:
            self.banner.config(text="Recognition is off\npress Start recognition to scan students", bg=IDLE_BG, fg=MUTED)
        elif st["arduino"] and not st["gate_open"]:
            self.banner.config(text="Stand at the marker and hold still for 1 second", bg=IDLE_BG, fg=INK)
        else:
            self.banner.config(text="Scanning · look at the camera" if st["arduino"] else "Ready · look at the camera", bg=IDLE_BG, fg=INK)

    def tick(self):
        st = self.door.state()
        self._show_frame(st["frame"], st["camera_error"])
        self._refresh_banner(st)
        if self._tick_n % 8 == 0:      # panels ~4 times a second is plenty
            self._refresh_panels(st, self.backend.snapshot())
        self._tick_n += 1
        self.root.after(30, self.tick)

    def run(self):
        self.root.after(50, self.tick)
        self.root.mainloop()

    def close(self):
        self.door.stop.set()
        self.backend.stop.set()
        self.root.destroy()


def run_gui(args):
    store = FaceStore(DATA)
    client = SrsClient(args.url, args.device_id, args.key)
    backend = Backend(client, store)
    door = DoorEngine(args, backend, store, client)
    log(f"backend {args.url}; device #{args.device_id}")
    backend.start()   # waits out a sleeping Render server by itself (shows OFFLINE until it answers)
    door.start()
    DoorWindow(args, door, backend).run()
    door.join(timeout=3)
    log(f"stopped ({len(backend.events)} event(s) still queued; they upload next time)")


def key_help(device_id):
    return (f"device key not accepted for device #{device_id}: copy the key from the web app "
            "(Venues & Devices > PC-01 > Copy) into device_key in config.ini, then restart")


def check(args):
    """--check: prove the URL, device id and key work, without touching the camera."""
    if not args.key or re.search(r"paste|change|xxx|your|here", args.key, re.I):
        raise SystemExit("device_key in config.ini is empty or still the example text.\n" + key_help(args.device_id))
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
    store = FaceStore(DATA)
    log(f"faces stored on this PC: {len(store.people)}")
    FaceEngine()
    log("face models load OK.")
    cams = list_cameras()
    log("cameras: " + (", ".join(f"#{i} {w}x{h}" for i, w, h in cams) or "none found")
        + (f"  (auto picks #{auto_camera(cams)})" if cams else ""))
    log("Everything is ready.")


if __name__ == "__main__":
    settings = load_settings()
    try:
        check(settings) if settings.check else run_gui(settings)
    except SrsError as e:
        raise SystemExit(f"Backend refused: {e}" + (f"\n{key_help(settings.device_id)}" if e.status in (401, 404) else ""))
