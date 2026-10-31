"""arduino_link.py - the connection to the Arduino door unit (arduino/srs_door), for srs_pc_app.py.

Reads the Arduino's messages on its own thread, so the live values (distance, door state, LCD,
firmware) stay current even without a camera, and runs the hardware test step by step.
The door program works without an Arduino; this only does something once a port is connected.

Messages from the Arduino (9600 baud, one per line):
  HELLO SRS-DOOR v2 LCD=0x27   S <cm> <state>   READY   AWAY   PONG v2   T ...  (see srs_door.ino)
"""
import threading
import time
from collections import deque

try:
    import serial
    from serial.tools import list_ports
except ImportError:  # pyserial is only needed with an Arduino
    serial = None
    list_ports = None

STATUS_STALE = 2.0   # seconds without an "S" line before the live values count as stale


def available_ports():
    """[(port, description)] of the serial ports on this PC, Arduino-looking ones first."""
    if not list_ports:
        return []
    ports = [(p.device, p.description or p.device) for p in list_ports.comports()]
    return sorted(ports, key=lambda p: (0 if "arduino" in p[1].lower() or "ch340" in p[1].lower() else 1, p[0]))


def guess_arduino_port():
    for port, desc in available_ports():
        if "arduino" in desc.lower() or "ch340" in desc.lower():
            return port
    return None


# The hardware test: (key, what is checked, what to do when it fails)
TEST_STEPS = [
    ("link", "Arduino connected over USB",
     "Plug in the Arduino, pick its port (e.g. COM20) in the Hardware panel and press Connect. Close the Arduino IDE's Serial Monitor."),
    ("firmware", "Door unit program answers",
     "Upload pc_device/arduino/srs_door/srs_door.ino with the Arduino IDE (board: Arduino Mega or Mega 2560), then Connect again."),
    ("lcd_bus", "LCD found on the I2C bus",
     "Check the LCD wires: VCC to 5V, GND to GND, SDA to pin 20 and SCL to pin 21 on a Mega (A4 / A5 on an Uno)."),
    ("lcd_view", "LCD shows the test screen",
     "Turn the small blue contrast screw on the back of the LCD until the text is visible. Check the backlight jumper is on."),
    ("buzzer", "Buzzer beeps",
     "Check the buzzer: + (long leg) to pin 8, - to GND. If it only clicks or hums, it is an active buzzer: set PASSIVE_BUZZER to false in srs_door.ino and upload again."),
    ("sonar", "Distance sensor gives readings",
     "Check the HC-SR04: VCC to 5V, GND to GND, TRIG to pin 9, ECHO to pin 10. Nothing should be right in front of it (or further than 4 m)."),
    ("sonar_hand", "Distance sensor sees your hand at 20-40 cm",
     "Hold a flat hand or a book 30 cm in front of the sensor, square to it. If readings jump around, check the TRIG/ECHO wires are not swapped."),
]


class ArduinoLink(threading.Thread):
    def __init__(self, log=print):
        super().__init__(daemon=True)
        self.log = log
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.ser = None
        self.port = None
        self.error = ""
        self.buf = b""
        self.firmware = None        # e.g. "v2" from HELLO / PONG
        self.lcd = None             # "0x27", "NONE" or None (unknown)
        self.distance = None        # cm, -1 = nothing in range
        self.unit_state = None      # WAITING / HOLDING / SCANNING / RESULT / LEAVING / TESTING
        self.status_at = 0.0        # when the last "S" line arrived
        self.last_line = ""
        self.last_line_at = 0.0
        self.gate_at = 0.0          # when the Arduino last said READY
        self.pong_at = 0.0
        self.test_lines = deque(maxlen=20)
        self.test = None            # the running/finished hardware test (see run_test)
        self.answer = None          # the person's answer to a test question
        self.answered = threading.Event()

    # -- connection
    @property
    def connected(self):
        return self.ser is not None

    def connect(self, port):
        self.disconnect()
        if serial is None:
            self.error = "pyserial is not installed (pip install pyserial)"
            return False
        try:
            ser = serial.Serial(port, 9600, timeout=0.1)
        except Exception as err:  # port busy, unplugged, ...
            self.error = f"cannot open {port}: {err}"
            self.log(f"Arduino: {self.error}")
            return False
        with self.lock:
            self.ser, self.port, self.error, self.buf = ser, port, "", b""
            self.firmware = self.lcd = self.distance = self.unit_state = None
            self.status_at = self.gate_at = 0.0
        self.log(f"Arduino: connected on {port} (it restarts, about 2 s)")
        return True

    def disconnect(self):
        with self.lock:
            ser, self.ser = self.ser, None
            self.gate_at = 0.0
        if ser:
            try:
                ser.close()
            except Exception:
                pass
            self.log("Arduino: disconnected")

    def send(self, text):
        ser = self.ser
        if not ser:
            return False
        try:
            ser.write((text + "\n").encode("ascii"))
            return True
        except Exception as err:
            self.error = f"write failed: {err}"
            self.log(f"Arduino: {self.error}")
            self.disconnect()
            return False

    # -- reading
    def run(self):
        while not self.stop.is_set():
            ser = self.ser
            if not ser:
                self.stop.wait(0.2)
                continue
            try:
                chunk = ser.read(256)
            except Exception as err:  # unplugged
                self.error = f"lost the connection: {err}"
                self.log(f"Arduino: {self.error}")
                self.disconnect()
                continue
            if not chunk:
                continue
            self.buf += chunk
            *lines, self.buf = self.buf.split(b"\n")
            for raw in lines:
                self._handle(raw.strip().decode("ascii", "ignore"))
        self.disconnect()

    def _handle(self, msg):
        if not msg:
            return
        now = time.time()
        with self.lock:
            if not msg.startswith("S "):
                self.last_line, self.last_line_at = msg, now
            parts = msg.split()
            if parts[0] == "S" and len(parts) >= 3:
                try:
                    self.distance = int(parts[1])
                except ValueError:
                    pass
                self.unit_state, self.status_at = parts[2], now
            elif parts[0] == "READY":
                self.gate_at = now
            elif parts[0] == "AWAY":
                self.gate_at = 0.0
            elif parts[0] == "HELLO":
                self.firmware = next((p for p in parts if p.startswith("v")), "v1")
                lcd = next((p.split("=", 1)[1] for p in parts if p.startswith("LCD=")), None)
                self.lcd = lcd
            elif parts[0] == "PONG":
                self.pong_at = now
                self.firmware = parts[1] if len(parts) > 1 else self.firmware
            elif parts[0] == "T":
                self.test_lines.append((now, msg))
        if parts[0] in ("HELLO",):
            self.log(f"Arduino: {msg}")

    # -- what the window and the door engine read
    def gate_open(self, window):
        return self.connected and time.time() - self.gate_at < window

    def clear_gate(self):
        self.gate_at = 0.0

    def status(self):
        now = time.time()
        with self.lock:
            live = self.connected and now - self.status_at < STATUS_STALE
            return dict(
                connected=self.connected, port=self.port, error=self.error, firmware=self.firmware, lcd=self.lcd,
                live=live, distance=self.distance if live else None, unit_state=self.unit_state if live else None,
                last_line=self.last_line, last_line_age=(now - self.last_line_at) if self.last_line_at else None,
                gate_open=self.gate_open(6), test=None if self.test is None else {
                    "running": self.test["running"], "question": self.test["question"],
                    "steps": [dict(s) for s in self.test["steps"]]},
            )

    # -- hardware test
    def start_test(self):
        if self.test and self.test["running"]:
            return
        self.test = {"running": True, "question": None,
                     "steps": [{"key": k, "label": l, "hint": h, "status": "pending", "detail": ""} for k, l, h in TEST_STEPS]}
        threading.Thread(target=self._run_test, daemon=True).start()

    def answer_question(self, yes):
        self.answer = bool(yes)
        self.answered.set()

    def _step(self, key, status, detail=""):
        for s in self.test["steps"]:
            if s["key"] == key:
                s["status"], s["detail"] = status, detail

    def _wait_line(self, prefix, timeout):
        """The next "T ..." line starting with prefix, or None after timeout seconds."""
        end = time.time() + timeout
        while time.time() < end:
            for at, line in list(self.test_lines):
                if line.startswith(prefix):
                    self.test_lines.remove((at, line))
                    return line
            time.sleep(0.05)
        return None

    def _ask(self, key, question):
        self.answer = None
        self.answered.clear()
        self.test["question"] = {"key": key, "text": question}
        self._step(key, "ask")
        self.answered.wait(timeout=120)
        self.test["question"] = None
        return self.answer

    def _skip_rest(self, after, why):
        seen = False
        for s in self.test["steps"]:
            if seen and s["status"] == "pending":
                s["status"], s["detail"] = "skipped", why
            seen = seen or s["key"] == after

    def _run_test(self):
        try:
            # 1. USB link
            if not self.connected:
                self._step("link", "fail", self.error or "not connected")
                self._skip_rest("link", "needs the Arduino connection")
                return
            self._step("link", "pass", self.port)
            # 2. the door unit program answers
            self._step("firmware", "running")
            self.pong_at = 0.0
            end = time.time() + 4
            while time.time() < end and not self.pong_at:
                self.send("P")
                time.sleep(0.8)
            if not self.pong_at:
                self._step("firmware", "fail", "no answer to P within 4 s (wrong program, or an old version without the test)")
                self._skip_rest("firmware", "needs the door unit program")
                return
            self._step("firmware", "pass", f"srs_door {self.firmware}")
            self.test_lines.clear()
            # 3-4. LCD
            self._step("lcd_bus", "running")
            self.send("TL")
            line = self._wait_line("T LCD", 5)
            if line and line.startswith("T LCD OK"):
                addr = line.split()[-1]
                self.lcd = addr
                self._step("lcd_bus", "pass", f"address {addr}")
                ok = self._ask("lcd_view", f"Does the LCD show 'LCD TEST {addr}' and a full row of blocks?")
                self._step("lcd_view", "pass" if ok else "fail", "you saw the test screen" if ok else "not visible")
            else:
                self.lcd = "NONE"
                self._step("lcd_bus", "fail", "no device at 0x27 or 0x3F" if line else "no answer")
                self._step("lcd_view", "skipped", "no LCD found")
            # 5. buzzer (cannot be measured: the person listens)
            self._step("buzzer", "running", "3 beeps...")
            self.send("TB")
            if self._wait_line("T BUZZER", 6):
                ok = self._ask("buzzer", "Did you hear 3 rising beeps?")
                self._step("buzzer", "pass" if ok else "fail", "heard" if ok else "not heard")
            else:
                self._step("buzzer", "fail", "the Arduino did not finish the beeps")
            # 6. distance sensor readings
            self._step("sonar", "running", "10 readings...")
            self.send("TS")
            line = self._wait_line("T SONAR", 6)
            if line and line.startswith("T SONAR OK"):
                _, _, _, cm, good = line.split()
                self._step("sonar", "pass", f"{good} readings, middle {cm} cm")
            else:
                self._step("sonar", "fail", "no echo at all (0/10)" if line else "no answer")
            # 7. sees a hand at the right distance (uses the live readings)
            self.send("TX")
            self.test["question"] = {"key": "sonar_hand", "text": "Hold your hand about 30 cm in front of the distance sensor (up to 15 s).", "wait": True}
            self._step("sonar_hand", "running", "waiting for a reading of 20-40 cm...")
            end, seen = time.time() + 15, None
            while time.time() < end and seen is None:
                d = self.distance
                if d is not None and 20 <= d <= 40:
                    seen = d
                time.sleep(0.1)
            self.test["question"] = None
            self._step("sonar_hand", "pass" if seen else "fail", f"saw {seen} cm" if seen else f"last reading {self.distance} cm")
        except Exception as err:  # never leave the test window hanging
            self.log(f"hardware test error: {err}")
        finally:
            self.send("TX")
            self.test["running"] = False
            self.test["question"] = None
            failed = [s["label"] for s in self.test["steps"] if s["status"] == "fail"]
            self.log("hardware test: " + ("all passed" if not failed else "FAILED: " + "; ".join(failed)))
