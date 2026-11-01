"""srs_pc_app.py - the Smart Registration System door program for a PC with a USB webcam.

It plays the ESP32-CAM's part (see Backend/DEVICE_API.md):
  * ENROL  - when an invigilator presses "Start enrolment" on the web console, this program sees
             the student in pending-enrollments, captures their face automatically, saves
             data/photos/<student number>.jpg and data/embeddings/<student number>.json on this PC,
             and reports "enrolled" (or "failed") and the photo back to the console.
             ONE FACE, ONE STUDENT - before saving, the new face is compared with every face already
             stored on this PC. If it matches another student's face, the enrolment is rejected
             (reported as failed) and a window shows both faces and their embeddings side by side, so
             the operator can see why. At the door, a face that matches two students is not accepted.
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
from datetime import datetime
from collections import deque
from pathlib import Path
from tkinter import ttk

import cv2
import numpy as np

# hide OpenCV's harmless warnings (empty camera slots while scanning, dnn engine notes)
try:
    cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_ERROR)
except AttributeError:
    pass

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "device_client"))
from srs_client import SrsClient, SrsError  # noqa: E402
from arduino_link import MAX_CM, MIN_CM, ArduinoLink, available_ports, guess_arduino_port  # noqa: E402
from face_engine import DUPLICATE_THRESHOLD, DuplicateFaceError, FaceEngine, FaceStore, average_embedding, embedding_strip  # noqa: E402

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


def save_setting(name, value):
    """Remember a choice in config.ini, changing only the 'name =' line (comments survive)."""
    if not CONFIG_FILE.exists():
        return
    text = CONFIG_FILE.read_text(encoding="utf-8")
    line = f"{name} = {value}"
    pattern = rf"(?m)^{re.escape(name)}\s*=.*$"
    text = re.sub(pattern, line, text) if re.search(pattern, text) else text.rstrip() + f"\n{line}\n"
    CONFIG_FILE.write_text(text, encoding="utf-8")


def save_camera_choice(index):
    save_setting("camera", index)


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
                # or a session ends (12:00 / 16:00: everyone is signed out)
                hour = time.localtime().tm_hour
                slot_now = ("09:00" if hour < 12 else "13:00", hour >= 16)
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


def session_over(session):
    """True once the exam session has ended (12:00 / 16:00): everyone is signed out then."""
    if session.get("ended"):
        return True
    if session.get("endsAt"):
        try:
            return time.time() >= datetime.fromisoformat(session["endsAt"].replace("Z", "+00:00")).timestamp()
        except ValueError:
            pass
    date, slot = session_key(session)
    hour = time.localtime().tm_hour
    return date == time.strftime("%Y-%m-%d") and ((slot == "09:00" and hour >= 12) or (slot == "13:00" and hour >= 16))


def session_key(session):
    """(date, slot) of the exam session: the server's when known, else this PC's clock (offline)."""
    if session.get("date") and session.get("slot"):
        return session["date"], session["slot"]
    return time.strftime("%Y-%m-%d"), ("09:00" if time.localtime().tm_hour < 12 else "13:00")


GREEN, RED, AMBER, WHITE = (60, 200, 60), (40, 40, 230), (0, 190, 255), (255, 255, 255)


# ---------------------------------------------------------------- camera + face worker
class DoorEngine(threading.Thread):
    """Reads the camera, finds faces, runs enrolments and door decisions. The window only displays
    what this thread publishes (latest frame + state), so slow face maths never freezes the GUI."""

    def __init__(self, args, backend, store, client, link):
        super().__init__(daemon=True)
        self.args = args
        self.backend = backend
        self.store = store
        self.client = client
        self.engine = FaceEngine()
        self.link = link               # the Arduino door unit (arduino_link.py); optional
        self.fps = 0.0                 # camera frames per second (live value for the window)
        self.face_px = None            # width of the biggest face in the picture, in pixels
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
        self.last_duplicate = None     # the last enrolment rejected as a duplicate (shown in the comparison window)
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
        self.link.clear_gate()
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
                        arduino=self.link.connected, gate_open=self._gate_open(), recognising=self.recognising,
                        fps=self.fps, face_px=self.face_px,
                        camera_error=self.camera_error, enrolling=enrol,
                        result=self.result if self.result and time.time() < self.result[2] else None,
                        faces_stored=len(self.store.people), history=list(self.history),
                        last_duplicate=self.last_duplicate)

    # -- enrolment
    def _finish_enrolment(self, ok, why=None):
        """Save (ok) or drop the enrolment and tell the backend. `why` = text for the banner and the log."""
        st = self.enrolling["student"]
        sid = st["studentId"]
        check = self.enrolling.get("check")
        if ok:
            # two files on this PC: data/photos/<number>.jpg and data/embeddings/<number>.json
            okj, jpg = cv2.imencode(".jpg", self.enrolling["frame"], [cv2.IMWRITE_JPEG_QUALITY, 85])
            photo = jpg.tobytes() if okj else None
            try:
                self.store.add(sid, st["studentNumber"], st["name"], self.enrolling["samples"], photo_jpg=photo,
                               duplicate_check=check)
            except (DuplicateFaceError, ValueError) as err:     # one face, one student: never stored twice
                ok, why, photo = False, str(err), None
            else:
                log(f"saved {self.store.photo_path(st['studentNumber']).name} and the embedding for {st['studentNumber']}")
            if ok and photo and len(photo) < 1_000_000:
                self.backend.tasks.put(lambda: self.client.upload_enrollment_image(sid, photo))
        self.backend.report_enrollment(sid, ok)
        self.handled.add(sid)
        title = "Enrolled" if ok else "Enrolment failed"
        self.result = ("granted" if ok else "denied", f"{title}: {st['name']}" + (f"\n{why}" if why else ""),
                       time.time() + SHOW_RESULT_SECONDS)
        log(("enrolled" if ok else "enrolment FAILED for"), st["studentNumber"], st["name"], f"({why})" if why else "")
        self.enrolling = None

    def _check_duplicates(self):
        """All samples taken: compare the new face with every face stored on this PC before saving.
        No match -> enrol now. A match with another student -> rejected (one face belongs to one student only);
        the comparison window shows both faces so the operator can see why."""
        e = self.enrolling
        st = e["student"]
        mean = average_embedding(e["samples"])
        matches, closest = self.store.find_duplicates(mean, exclude_id=st["studentId"])
        compared = sum(1 for sid in self.store.people if sid != st["studentId"])
        # kept in the new embedding file, so it can be checked later what was compared and decided
        e["check"] = {
            "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "facesCompared": compared,
            "threshold": DUPLICATE_THRESHOLD,
            "closest": ({"studentNumber": self.store.people[closest[0]]["studentNumber"],
                         "name": self.store.people[closest[0]]["name"], "similarity": round(closest[1], 3)}
                        if closest else None),
            "possibleDuplicates": [{"studentNumber": self.store.people[sid]["studentNumber"],
                                    "name": self.store.people[sid]["name"], "similarity": round(sim, 3)}
                                   for sid, sim in matches],
            "decision": "no duplicate found",
        }
        near = f"closest {e['check']['closest']['name']} {closest[1]:.2f}" if closest else "no other faces stored"
        if not matches:
            log(f"duplicate check {st['studentNumber']}: compared with {compared} face(s), no match ({near})")
            return self._finish_enrolment(True, f"no duplicate among {compared} stored face(s)")
        # pictures for the comparison window: the face each embedding was made from + the embedding strip
        new_face = self.engine.aligned_face(e["frame"], e["face"])
        others = []
        for sid, sim in matches:
            p = self.store.people[sid]
            photo_file = self.store.photo_path(p["studentNumber"])
            photo = cv2.imdecode(np.fromfile(str(photo_file), np.uint8), cv2.IMREAD_COLOR) if photo_file.exists() else None
            others.append(dict(studentId=sid, name=p["name"], number=p["studentNumber"], similarity=sim,
                               face=self.engine.aligned_face(photo), strip=embedding_strip(p["embedding"]),
                               photo_file=photo_file.name if photo_file.exists() else None,
                               embedding_file=self.store.embedding_path(p["studentNumber"]).name))
        first = others[0]
        e["check"]["decision"] = f"rejected: face already enrolled for {first['number']} {first['name']}"
        self.last_duplicate = dict(id=time.time(), name=st["name"], number=st["studentNumber"], face=new_face,
                                   strip=embedding_strip(mean), compared=compared, matches=others)
        log(f"DUPLICATE FACE {st['studentNumber']} {st['name']}: already enrolled as "
            + ", ".join(f"{m['number']} {m['name']} ({m['similarity']:.2f})" for m in others) + " - enrolment rejected")
        return self._finish_enrolment(False, f"face already enrolled for {first['number']} {first['name']}")

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
            e["face"] = face.copy()       # where the face is in e["frame"] (for the comparison picture)
            if len(e["samples"]) >= ENROL_SAMPLES:
                self._check_duplicates()

    # -- Arduino distance gate
    def _gate_open(self):
        """True while the Arduino says a student has held the right distance (always True without one)."""
        return not self.link.connected or self.link.gate_open(GATE_SECONDS)

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
        # one face, one student: a face that matches two enrolled students is not accepted as either
        ambiguous = self.store.last_ambiguous
        # a student is let in once per exam session: who is in = let in here + what the server reports
        let_in = self.let_in.setdefault(session_key(session), set())
        # after the session ends (12:00 / 16:00) everyone is signed out and not let in again
        ended = sid is not None and (session_over(session) or sid in session.get("sessionEndedFor", []))
        inside = sid is not None and not ended and (sid in let_in or sid in session.get("alreadyInside", []))
        label = ((f"{person['name']} · session ended" if ended else f"{person['name']} · already inside" if inside else person["name"])
                 if person else "matches 2 students" if ambiguous else "not recognised")
        answer = sid if sid is not None else "unknown"
        cand, n = self.streak
        self.streak = (answer, n + 1) if cand == answer else (answer, 1)
        if self.streak[1] < VERIFY_CONFIRM:
            return label
        self.streak = (None, 0)
        # With the Arduino every scan is a deliberate 1-second hold at the marker (and the student must
        # step away before the next), so each one gets an answer. Without it, repeats are suppressed.
        if self.link.connected:
            self.link.clear_gate()
        elif sid is None:
            if self.unknown_logged:
                return label
            self.unknown_logged = True
        elif now - self.recent.get(sid, 0) < (ALREADY_REPEAT_SECONDS if inside or ended else SAME_PERSON_COOLDOWN):
            return label
        # every enrolled student is recognised and let through ONCE per session; the web console shows
        # whether they have a seat in the exam running now
        seat = {s["studentId"]: s for s in session.get("students", [])}.get(sid)
        if person and ended:
            decision, text = "ended", f"SESSION ENDED  {person['name']}\n{person['studentNumber']} · signed out, not let in"
        elif person and inside:
            decision, text = "already", f"ALREADY INSIDE  {person['name']}\n{person['studentNumber']} · let in earlier this session"
        elif person:
            where = f"seat {seat['seatNumber']} · {seat['moduleCode']}" if seat else "no exam seat in this session"
            decision, text = "granted", f"RECOGNISED  {person['name']}\n{person['studentNumber']} · {where}"
            let_in.add(sid)
        elif ambiguous:
            a, b = (self.store.people[x] for x in ambiguous)
            decision, text = "denied", f"NOT RECOGNISED\nface matches {a['studentNumber']} and {b['studentNumber']}: check the card"
        else:
            decision, text = "denied", "NOT RECOGNISED\nface is not enrolled"
        if sid is not None:
            self.recent[sid] = now
        self.backend.record(decision, sid)
        if self.link.connected:
            self.link.send({"granted": "G", "already": "A"}.get(decision, "D"))
        self.result = (decision, text, now + SHOW_RESULT_SECONDS)
        who = (f"{person['studentNumber']} {person['name']}" if person
               else "face matching " + " and ".join(self.store.people[x]["studentNumber"] for x in ambiguous) if ambiguous
               else "unknown face")
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
        last_frame = 0.0
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
            now = time.time()
            if last_frame:
                self.fps = 0.9 * self.fps + 0.1 / max(1e-3, now - last_frame)  # smoothed frames per second
            last_frame = now
            faces = self.engine.detect(frame)
            self.face_px = int(faces[0][2]) if len(faces) else None
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


# ---------------------------------------------------------------- window
BG, PANEL, INK, MUTED = "#f4f6f9", "#ffffff", "#1f2937", "#6b7280"
OK_BG, BAD_BG, WARN_BG, IDLE_BG = "#16a34a", "#dc2626", "#d97706", "#e5e7eb"


def value_grid(parent, rows):
    """Label/value pairs, two per row; a row with one name spans the full width. Returns {name: value label}."""
    for c in (1, 3):
        parent.columnconfigure(c, weight=1, uniform="value")
    vals = {}
    for r, names in enumerate(rows):
        for i, key in enumerate(names):
            col = i * 2
            ttk.Label(parent, text=key, style="Muted.TLabel").grid(row=r, column=col, sticky="nw", padx=(0 if col == 0 else 12, 8), pady=1)
            v = tk.Label(parent, text="—", bg=PANEL, fg=INK, font=("Segoe UI", 10), anchor="w", justify="left",
                         wraplength=440 if len(names) == 1 else 170)
            v.grid(row=r, column=col + 1, columnspan=3 if len(names) == 1 else 1, sticky="ew", pady=1)
            vals[key] = v
    return vals


def bgr_to_photo(img, size=None):
    """An OpenCV (BGR) picture as a Tk image, optionally scaled to fit size=(w, h). Tk reads PPM natively, so no Pillow."""
    if size:
        h, w = img.shape[:2]
        scale = min(size[0] / w, size[1] / h)
        if scale != 1:
            img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC)
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    h, w = rgb.shape[:2]
    return tk.PhotoImage(width=w, height=h, data=b"P6 %d %d 255 " % (w, h) + rgb.tobytes(), format="PPM")


FACE_BOX = (168, 168)   # size of each face in the duplicate window


class DuplicateWindow:
    """Pop-up shown when an enrolment was rejected because the face is already stored for another student
    on this PC: the new face and the enrolled one(s) side by side, with their embeddings as colour strips and
    the similarity, so the operator can see why. One face belongs to one student only, so there is no
    "enrol anyway": if the stored face is on the wrong student, re-enrol or delete that student first."""

    def __init__(self, root, review):
        self.review_id = review["id"]
        self._images = []               # Tk drops images that nothing references, so keep them here
        w = self.win = tk.Toplevel(root)
        w.title("Enrolment rejected: face already enrolled")
        w.configure(bg=PANEL, padx=16, pady=14)
        w.protocol("WM_DELETE_WINDOW", self.close)
        w.attributes("-topmost", True)  # stay in front of the door window until closed
        tk.Label(w, text="Enrolment rejected: this face is already enrolled for another student", bg=PANEL, fg=BAD_BG,
                 font=("Segoe UI Semibold", 14)).pack(anchor="w")
        tk.Label(w, text=f"Compared with {review['compared']} face(s) stored on this PC. One face may belong to one student "
                         f"only, and the door treats a similarity of {DUPLICATE_THRESHOLD:.2f} or more as the same face.",
                 bg=PANEL, fg=MUTED, font=("Segoe UI", 10), justify="left", wraplength=640).pack(anchor="w", pady=(2, 10))

        cards = tk.Frame(w, bg=PANEL)
        cards.pack(anchor="w")
        self._card(cards, 0, "REJECTED ENROLMENT", review["name"], review["number"], review["face"], review["strip"],
                   ["captured just now", "not saved, reported as failed"], "#2563eb")
        for n, m in enumerate(review["matches"], start=1):
            files = [f"photo: data/photos/{m['photo_file']}" if m["photo_file"] else "photo: missing on this PC",
                     f"embedding: data/embeddings/{m['embedding_file']}"]
            self._card(cards, n, f"ALREADY ENROLLED · similarity {m['similarity']:.2f}", m["name"], m["number"],
                       m["face"], m["strip"], files, BAD_BG)

        tk.Label(w, text="The coloured strips are the 128 embedding numbers (blue = low, red = high): "
                         "the same face gives the same pattern.\nIf the enrolled face is on the wrong student, re-enrol or "
                         "delete that student on the web console first, then press Re-enrol for this one.",
                 bg=PANEL, fg=INK, font=("Segoe UI", 10), justify="left", wraplength=640).pack(anchor="w", pady=(12, 8))
        tk.Button(w, text="Close", command=self.close, bg=INK, fg="white", activebackground=INK, activeforeground="white",
                  relief="flat", padx=16, pady=6, cursor="hand2", font=("Segoe UI Semibold", 10)).pack(anchor="w")
        w.lift()
        w.focus_force()

    def _card(self, parent, col, heading, name, number, face, strip, notes, color):
        """One column: heading, the face the embedding was made from, the embedding strip, name and files."""
        box = tk.Frame(parent, bg=PANEL, highlightbackground=color, highlightthickness=2, padx=8, pady=8)
        box.grid(row=0, column=col, sticky="n", padx=(0, 10))
        tk.Label(box, text=heading, bg=PANEL, fg=color, font=("Segoe UI Semibold", 9)).pack(anchor="w")
        if face is not None:
            img = bgr_to_photo(face, FACE_BOX)
            self._images.append(img)
            tk.Label(box, image=img, bg=PANEL).pack(pady=(4, 4))
        else:
            tk.Label(box, text="no photo / no face found", bg="#111827", fg="#9ca3af", width=22, height=10).pack(pady=(4, 4))
        img = bgr_to_photo(strip, (FACE_BOX[0], 18))
        self._images.append(img)
        tk.Label(box, image=img, bg=PANEL).pack()
        tk.Label(box, text=name, bg=PANEL, fg=INK, font=("Segoe UI Semibold", 10), wraplength=FACE_BOX[0]).pack(anchor="w", pady=(6, 0))
        tk.Label(box, text=number, bg=PANEL, fg=INK, font=("Segoe UI", 10)).pack(anchor="w")
        for line in notes:
            tk.Label(box, text=line, bg=PANEL, fg=MUTED, font=("Segoe UI", 8), wraplength=FACE_BOX[0], justify="left").pack(anchor="w")

    def close(self):
        if self.win is not None and self.win.winfo_exists():
            self.win.destroy()
        self.win = None


class DoorWindow:
    def __init__(self, args, door, backend, link):
        self.args, self.door, self.backend, self.link = args, door, backend, link
        self.root = root = tk.Tk()
        root.title("SRS Door")
        root.configure(bg=BG)
        root.geometry("900x780")   # the layout needs about 860x760; resize freely
        root.minsize(840, 700)
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
        self.dev_vals = value_grid(dev, [["Server"], ["Device", "Venue"], ["Last contact", "Faces on this PC"],
                                         ["Queued events", "Camera"]])

        # the Arduino door unit: live values, port, Connect, and the hardware test
        hw = ttk.LabelFrame(left, text="Hardware (Arduino door unit)", style="Panel.TLabelframe", padding=10)
        hw.grid(row=1, column=0, sticky="ew", pady=(0, 8))
        self.hw_vals = value_grid(hw, [["Arduino", "Distance"], ["Door unit", "LCD"], ["Buzzer", "Last message"]])
        hwrow = tk.Frame(hw, bg=PANEL)
        hwrow.grid(row=3, column=0, columnspan=4, sticky="ew", pady=(8, 0))
        self.port_pick = ttk.Combobox(hwrow, state="readonly", width=30)
        self.port_pick.pack(side="left")
        ttk.Button(hwrow, text="Ports", width=6, command=self._scan_ports).pack(side="left", padx=(4, 0))
        self.connect_btn = ttk.Button(hwrow, text="Connect", command=self._connect_toggle)
        self.connect_btn.pack(side="left", padx=4)
        tk.Button(hwrow, text="Test hardware", command=self._open_test, bg=INK, fg="white", activebackground=INK,
                  activeforeground="white", relief="flat", cursor="hand2", padx=10).pack(side="right")
        self._ports = []
        self._scan_ports()
        self.test_win = None

        ses = ttk.LabelFrame(left, text="Exam session", style="Panel.TLabelframe", padding=10)
        ses.grid(row=2, column=0, sticky="nsew", pady=(0, 8))
        ses.columnconfigure(0, weight=1)
        ses.rowconfigure(1, weight=1)
        self.ses_title = ttk.Label(ses, text="—", style="P.TLabel")
        self.ses_title.grid(row=0, column=0, sticky="w", pady=(0, 6))
        cols = ("seat", "number", "name", "module")
        self.seats = ttk.Treeview(ses, columns=cols, show="headings", height=4)
        for c, w in zip(cols, (50, 110, 200, 80)):
            self.seats.heading(c, text=c.capitalize())
            self.seats.column(c, width=w, anchor="w", stretch=c == "name")
        self.seats.grid(row=1, column=0, sticky="nsew")
        self._session_key = None

        act = ttk.LabelFrame(left, text="Activity", style="Panel.TLabelframe", padding=10)
        act.grid(row=3, column=0, sticky="nsew")
        act.columnconfigure(0, weight=1)
        act.rowconfigure(0, weight=1)
        self.log_box = tk.Listbox(act, font=("Consolas", 9), bg=PANEL, fg=INK, borderwidth=0, highlightthickness=0, activestyle="none", height=5)
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
        self.enr_hint = ttk.Label(enr, text="Start an enrolment on the web console's Enrolment page.", style="Muted.TLabel",
                                  wraplength=VIDEO_W - 30)
        self.enr_hint.grid(row=1, column=0, columnspan=2, sticky="w", pady=(2, 6))
        self.enr_bar = ttk.Progressbar(enr, maximum=ENROL_SAMPLES, style="Enrol.Horizontal.TProgressbar")
        self.enr_bar.grid(row=2, column=0, sticky="ew")
        self.skip_btn = ttk.Button(enr, text="Skip", command=door.request_skip, state="disabled")
        self.skip_btn.grid(row=2, column=1, padx=(8, 0))
        self._cams_shown = None

        self._photo = None
        self.dup_win = None            # DuplicateWindow showing the last rejected duplicate
        self._dup_shown = None         # id of the duplicate already shown (each is shown once)
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
        self._photo = bgr_to_photo(frame, (VIDEO_W, VIDEO_H))
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
        face = f" · face {st['face_px']} px (min {self.args.min_face})" if st["face_px"] else " · no face in view"
        self.dev_vals["Camera"].config(text=f"#{st['camera']} · {st['fps']:.0f} frames/s{face}" if st["camera"] is not None else "no camera")
        self._refresh_hardware(self.link.status(), st)

        e = st["enrolling"]
        if e:
            self.enr_title.config(text=f"Enrolling {e['name']} ({e['number']})")
            self.enr_hint.config(text=f"{e['hint'] or 'Look at the camera'}   ·   {e['seconds_left']} s left")
            self.enr_bar.config(value=e["samples"])
            self.skip_btn.config(state="normal")
        else:
            waiting = len(snap["pending"])
            self.enr_title.config(text=f"{waiting} enrolment(s) waiting" if waiting else "Waiting for the web console…")
            self.enr_hint.config(text="Start an enrolment on the web console's Enrolment page.")
            self.enr_bar.config(value=0)
            self.skip_btn.config(state="disabled")

        s = snap["session"]
        key = (s.get("date"), s.get("slot"), session_over(s), tuple(x["studentId"] for x in s.get("students", [])))
        if key != self._session_key:
            self._session_key = key
            students = s.get("students", [])
            self.ses_title.config(text=f"{s.get('date') or '—'}  {s.get('slot') or ''}   ·   {len(students)} seated"
                                  + ("   ·   ENDED, everyone signed out" if session_over(s)
                                     else "" if students else "   (no exam booked in this venue now)"))
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

    # -- hardware (Arduino) panel
    def _scan_ports(self):
        self._ports = available_ports()
        labels = [f"{port}  {desc}" for port, desc in self._ports]
        self.port_pick.config(values=labels or ["no serial ports found"])
        want = self.link.port or self.args.serial or guess_arduino_port()
        idx = next((n for n, (port, _) in enumerate(self._ports) if port == want), 0 if self._ports else -1)
        if idx >= 0:
            self.port_pick.current(idx)
        else:
            self.port_pick.set("no serial ports found")

    def _connect_toggle(self):
        if self.link.connected:
            self.link.disconnect()
            save_setting("serial_port", "")          # stay without the Arduino next time too
            return
        n = self.port_pick.current()
        if n < 0 or n >= len(self._ports):
            log("Arduino: pick a port first (press Ports to look again)")
            return
        port = self._ports[n][0]
        if self.link.connect(port):
            save_setting("serial_port", port)        # connect to it again at the next start

    def _refresh_hardware(self, hs, st):
        def put(key, text, color=INK):
            self.hw_vals[key].config(text=text, fg=color)
        if not hs["connected"]:
            put("Arduino", "not connected" + (f" ({hs['error']})" if hs["error"] else " (not needed)"), MUTED)
            for k in ("Distance", "Door unit", "LCD", "Buzzer"):
                put(k, "—", MUTED)
        else:
            fw = f" · {hs['firmware']}" if hs["firmware"] else " · starting…"
            put("Arduino", f"{hs['port']}{fw}", OK_BG)
            d = hs["distance"]
            if not hs["live"]:
                put("Distance", "no readings (old firmware?)", WARN_BG)
            elif d is None or d < 0:
                put("Distance", "nothing in range", MUTED)
            elif d < MIN_CM:
                put("Distance", f"{d} cm · too close", WARN_BG)
            elif d <= MAX_CM:
                put("Distance", f"{d} cm · in range", OK_BG)
            else:
                put("Distance", f"{d} cm · too far", MUTED)
            state = hs["unit_state"] or "—"
            put("Door unit", f"{state}" + (" · take picture" if hs["gate_open"] else ""), OK_BG if hs["gate_open"] else INK)
            lcd = hs["lcd"]
            put("LCD", "found at " + lcd if lcd and lcd != "NONE" else ("NOT FOUND (check SDA/SCL)" if lcd == "NONE" else "unknown"),
                OK_BG if lcd and lcd != "NONE" else (BAD_BG if lcd == "NONE" else MUTED))
            put("Buzzer", hs["buzzer"] if hs["buzzer"] else "unknown",
                INK if hs["buzzer"] else MUTED)
        age = hs["last_line_age"]
        put("Last message", f"{hs['last_line']} ({age:.0f} s)" if hs["last_line"] and age is not None else "—", INK if hs["last_line"] else MUTED)
        self.connect_btn.config(text="Disconnect" if hs["connected"] else "Connect")
        if self.test_win is not None:
            self._refresh_test(hs["test"])

    # -- hardware test window
    ICONS = {"pass": ("✔", OK_BG), "fail": ("✖", BAD_BG), "running": ("…", "#2563eb"), "ask": ("?", WARN_BG),
             "pending": ("·", MUTED), "skipped": ("–", MUTED)}

    # steps you confirm yourself: (yes button, no button, repeat button, command that repeats it)
    CONFIRM = {
        "lcd_view": ("Yes, I can see it", "No, it's blank or wrong", "Show it again", "TL"),
        "buzzer": ("Yes, I heard 3 beeps", "No, I heard nothing (try the other type)", "Beep again", "TB"),
    }

    def _open_test(self):
        if self.test_win is None or not self.test_win.winfo_exists():
            w = self.test_win = tk.Toplevel(self.root)
            w.title("Hardware test")
            w.configure(bg=PANEL, padx=16, pady=14)
            w.geometry("600x680")
            w.protocol("WM_DELETE_WINDOW", self._close_test)
            tk.Label(w, text="Hardware test", bg=PANEL, fg=INK, font=("Segoe UI Semibold", 14)).pack(anchor="w")
            self.test_summary = tk.Label(w, text="", bg=PANEL, fg=MUTED, font=("Segoe UI", 10), anchor="w", justify="left")
            self.test_summary.pack(anchor="w", pady=(0, 8))
            self.test_rows = {}
            box = tk.Frame(w, bg=PANEL)
            box.pack(fill="x")
            box.columnconfigure(1, weight=1)
            from arduino_link import TEST_STEPS
            for r, (key, label, _) in enumerate(TEST_STEPS):
                icon = tk.Label(box, text="·", bg=PANEL, font=("Segoe UI Semibold", 14), width=2)
                icon.grid(row=r * 3, column=0, sticky="nw")
                name = tk.Label(box, text=label, bg=PANEL, fg=INK, font=("Segoe UI Semibold", 10), anchor="w")
                name.grid(row=r * 3, column=1, sticky="w")
                detail = tk.Label(box, text="", bg=PANEL, fg=MUTED, font=("Segoe UI", 9), anchor="w", justify="left", wraplength=500)
                detail.grid(row=r * 3 + 1, column=1, sticky="w")
                # what you see or hear is confirmed right in its own row (hidden until asked)
                buttons = None
                if key in self.CONFIRM:
                    yes, no, again, cmd = self.CONFIRM[key]
                    buttons = tk.Frame(box, bg="#fffbeb", padx=8, pady=6, highlightbackground="#fcd34d", highlightthickness=1)
                    tk.Button(buttons, text=yes, bg=OK_BG, fg="white", activebackground=OK_BG, relief="flat", padx=10, cursor="hand2",
                              command=lambda: self.link.answer_question(True)).pack(side="left")
                    tk.Button(buttons, text=no, bg=BAD_BG, fg="white", activebackground=BAD_BG, relief="flat", padx=10, cursor="hand2",
                              command=lambda: self.link.answer_question(False)).pack(side="left", padx=6)
                    ttk.Button(buttons, text=again, command=lambda c=cmd: self.link.send(c)).pack(side="left")
                    buttons.grid(row=r * 3 + 2, column=1, sticky="w", pady=(4, 2))
                    buttons.grid_remove()
                tk.Frame(box, bg=PANEL, height=6).grid(row=r * 3 + 2, column=0)
                self.test_rows[key] = (icon, detail, buttons)
            bottom = tk.Frame(w, bg=PANEL)
            bottom.pack(side="bottom", fill="x", pady=(10, 0))
            ttk.Button(bottom, text="Close", command=self._close_test).pack(side="right")
            self.test_again = ttk.Button(bottom, text="Run again", command=self.link.start_test)
            self.test_again.pack(side="right", padx=6)
        else:
            self.test_win.lift()
        self.link.start_test()

    def _close_test(self):
        if self.link.test and self.link.test["running"]:
            self.link.answer_question(False)   # unblock a question; the test ends by itself
        if self.test_win is not None:
            self.test_win.destroy()
        self.test_win = None

    def _refresh_test(self, test):
        if not test or not self.test_win.winfo_exists():
            return
        q = test["question"]
        for st in test["steps"]:
            icon, detail, buttons = self.test_rows[st["key"]]
            ch, color = self.ICONS.get(st["status"], ("·", MUTED))
            icon.config(text=ch, fg=color)
            asking = q is not None and q["key"] == st["key"]
            text, fg = st["detail"], MUTED
            if asking:
                text, fg = q["text"], INK          # the question, right where the buttons are
            elif st["status"] == "fail":
                text, fg = (text + "\n" if text else "") + "What to check: " + st["hint"], BAD_BG
            detail.config(text=text, fg=fg, font=("Segoe UI Semibold", 10) if asking else ("Segoe UI", 9))
            if buttons is not None:
                if asking and not q.get("wait"):
                    buttons.grid()
                else:
                    buttons.grid_remove()
        failed = [s["label"] for s in test["steps"] if s["status"] == "fail"]
        if test["running"]:
            self.test_summary.config(text="Testing… answer in the yellow box when asked.", fg=MUTED)
        elif failed:
            self.test_summary.config(text=f"{len(failed)} problem(s) found: " + "; ".join(failed), fg=BAD_BG)
        else:
            done = sum(1 for s in test["steps"] if s["status"] == "pass")
            self.test_summary.config(text=f"All {done} checks passed.", fg=OK_BG)
        self.test_again.config(state="disabled" if test["running"] else "normal")

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

    def _refresh_duplicate(self, st):
        """Show each rejected duplicate once in the comparison window (it stays until closed)."""
        dup = st["last_duplicate"]
        if dup is None or dup["id"] == self._dup_shown:
            return
        self._dup_shown = dup["id"]
        if self.dup_win is not None:
            self.dup_win.close()
        self.dup_win = DuplicateWindow(self.root, dup)

    def tick(self):
        st = self.door.state()
        self._show_frame(st["frame"], st["camera_error"])
        self._refresh_banner(st)
        self._refresh_duplicate(st)
        if self._tick_n % 8 == 0:      # panels ~4 times a second is plenty
            self._refresh_panels(st, self.backend.snapshot())
        self._tick_n += 1
        self.root.after(30, self.tick)

    def run(self):
        self.root.after(50, self.tick)
        self.root.mainloop()

    def close(self):
        self.door.stop.set()
        self.link.stop.set()
        self.backend.stop.set()
        self.root.destroy()


def warn_duplicate_faces(store):
    """One face, one student: list stored faces that belong to two students (e.g. enrolled before this rule).
    The door refuses such a face until one of the two students is re-enrolled or deleted."""
    pairs = store.duplicate_pairs()
    for a, b, sim in pairs:
        pa, pb = store.people[a], store.people[b]
        log(f"DUPLICATE FACE STORED: {pa['studentNumber']} {pa['name']} ~ {pb['studentNumber']} {pb['name']} "
            f"(similarity {sim:.2f}): the door refuses this face; re-enrol or delete the wrong student")
    return pairs


def run_gui(args):
    store = FaceStore(DATA)
    warn_duplicate_faces(store)
    client = SrsClient(args.url, args.device_id, args.key)
    backend = Backend(client, store)
    link = ArduinoLink(log=log)       # the Arduino door unit; the program works without it
    link.start()
    if args.serial:
        link.connect(args.serial)
    door = DoorEngine(args, backend, store, client, link)
    log(f"backend {args.url}; device #{args.device_id}")
    backend.start()   # waits out a sleeping Render server by itself (shows OFFLINE until it answers)
    door.start()
    DoorWindow(args, door, backend, link).run()
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
    pairs = warn_duplicate_faces(store)
    log(f"faces stored for two students: {len(pairs) or 'none'}")
    FaceEngine()
    log("face models load OK.")
    cams = list_cameras()
    log("cameras: " + (", ".join(f"#{i} {w}x{h}" for i, w, h in cams) or "none found")
        + (f"  (auto picks #{auto_camera(cams)})" if cams else ""))
    ports = available_ports()
    log("serial ports: " + (", ".join(f"{p} ({d})" for p, d in ports) or "none")
        + (f"  (Arduino looks like {guess_arduino_port()})" if guess_arduino_port() else ""))
    log("Everything is ready.")


if __name__ == "__main__":
    settings = load_settings()
    try:
        check(settings) if settings.check else run_gui(settings)
    except SrsError as e:
        raise SystemExit(f"Backend refused: {e}" + (f"\n{key_help(settings.device_id)}" if e.status in (401, 404) else ""))
