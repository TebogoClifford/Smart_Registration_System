# PC door program (webcam face recognition)

`srs_pc_app.py` turns a Windows PC with a USB webcam into an SRS door device. It talks to the backend through the same device API an ESP32-CAM would use (see [`../Backend/DEVICE_API.md`](../Backend/DEVICE_API.md)), using [`../device_client/srs_client.py`](../device_client/srs_client.py).

| What happens | What you see |
|---|---|
| An invigilator presses **Start enrolment** on the web console's Enrolment page | The window shows *Enrolling name*, takes 5 pictures once one face is close enough, and the web page changes to **Enrolled** |
| The new face is already enrolled for another student on this PC | The enrolment is **rejected** (reported as *failed*): one face belongs to one student only. An **Enrolment rejected** window shows both faces, their embeddings as colour strips and the similarity, so you can see why. If the stored face is on the wrong student, re-enrol or delete that student first |
| **Start recognition** is pressed (recognition is **off** when the program starts) | The door begins scanning faces. Press **Stop recognition** to pause it; enrolment works either way |
| An enrolled student walks up | **RECOGNISED name**, with *seat N · module* when they have a seat in this hall's current exam session (09:00 before 12:00, 13:00 after), or *no exam seat in this session*. Every enrolled student is let in once per session; the web console shows who has no seat |
| The same student again in that session | **ALREADY INSIDE** (amber) |
| After their session has ended (12:00 / 16:00) | **SESSION ENDED** – they were signed out automatically and are not let in again |
| A face that matches nobody | **NOT RECOGNISED** |
| A face that matches two enrolled students (stored before the one-face rule) | **NOT RECOGNISED** with both student numbers: check the card, then re-enrol or delete the wrong student |
| Every decision | Appears on the web console's Dashboard. While offline, decisions are queued on disk and uploaded later (never twice) |

Face embeddings (the 128 numbers that describe a face) stay on this PC in `data/embeddings/`, the enrolment photos in `data/photos/`. The backend only stores the result and one photo for re-enrolment.

## Set up (once)
Needs Python 3.9 or newer with Tkinter (included in the Windows installer from python.org; on Linux install `python3-tk`).
Everything else is installed by the program itself:
```
cd pc_device
python srs_pc_app.py
```
At every start `check_dependencies.py` checks the packages in `requirements.txt` and the two OpenCV Zoo face models
(~39 MB, checksum-verified). Whatever is missing is installed (`pip install`) or downloaded (`download_models.py`), and
the program carries on in the same run, no restart needed. When everything is there this takes well under a second.
The first start also creates `config.ini` from `config.example.ini`.
Then fill in `device_id` and `device_key` in `config.ini`. An **administrator** finds them on the device's page in the web console (Venues & Devices → the device → **Reveal**). Invigilators cannot see keys.
If an administrator replaces the key there (**Replace**), copy the new one into `device_key` and restart the program; until then it shows OFFLINE with "device key not accepted".

To set up or repair a PC without starting the door: `python check_dependencies.py` (`--check` only reports).

### Without a dependency
The door program **always starts**. Anything that cannot be installed (no internet, no pip, no rights) is listed in
the console and the Activity log as `NOT READY`, with the command that fixes it, and only its own feature is switched off:

| Missing | What still works | What is off |
|---|---|---|
| `requests` | everything on this PC; decisions are queued in `data/event_queue.json` | the server connection (shows OFFLINE) |
| `pyserial` | everything | the Arduino door unit |
| face models | the window, server connection, camera picture, Arduino | enrolment and recognition (banner: *Face recognition unavailable*) |
| `opencv-python` / `numpy` | the window, server connection, seat list, Arduino | the camera, enrolment and recognition |
| Tkinter | the whole door in the console (recognition starts by itself; Ctrl+C stops it) | the window |

Install it and restart the program to switch the feature back on. Use `--no-install` to skip installing at start-up.

## One-file .exe for other PCs (no Python needed there)
On this PC, double-click `build_exe.bat` (or run it in a terminal). It installs PyInstaller, fetches the
models and builds **`dist\SRS Door.exe`** (about 106 MB), the whole program with the face models inside.

On each door PC:
1. Copy `SRS Door.exe` into a folder of its own, e.g. `C:\SRS Door\` (somewhere it may write files).
2. Start it once: it writes `config.ini` next to itself and says what is missing.
3. Fill in `device_id` and `device_key` in that `config.ini` (each door PC gets its own device in the web console), then start it again.

It keeps `config.ini` and `data\` (faces enrolled on this PC, offline queue) next to the .exe; nothing else is
installed. Start-up takes a few seconds because it unpacks itself first. Windows SmartScreen may warn about an
unknown app the first time: **More info → Run anyway**. Clone Arduinos with a CH340 chip need the CH340 driver on that PC.

## Run
```
python srs_pc_app.py --check       # tests URL, key, models, cameras and serial ports, no camera window
python srs_pc_app.py               # opens the door window
python srs_pc_app.py --no-install  # the same, but only reports missing dependencies
```
**The window:** on the right, the camera picture with the result banner under it, the **Start recognition** button, the camera picker and the **Enrolment** panel (progress bar and **Skip**). On the left: the **Device** panel (server, device, last contact, faces stored, queued events, camera), the **Hardware** panel for the Arduino door unit, the current **Exam session** with its seat list, and the **Activity** log. Close the window or press **Esc** to stop.

**Choosing the camera:** pick it from the **Camera** list under the video (press **Rescan** after plugging a webcam in). The choice is saved in `config.ini`. With `camera = auto` the highest-numbered camera is used, which is normally a USB webcam rather than the laptop's built-in one. `python webcam_test.py` checks the cameras on their own.

Options (or in `config.ini`): `--url`, `--device-id`, `--key`, `--camera 0` (default `auto`), `--serial COM3` (the Arduino door unit, see below), `--min-face 90` (pixels; raise it to make people step closer).

## Arduino door unit (optional): distance sensor and LCD

`arduino/srs_door/srs_door.ino` (version 3) runs on an Arduino Mega, Uno or Nano. The student must stand 25–50 cm
from the sensor and hold still for **1 second**; only then does the Arduino tell this
program to take the picture. The answer appears on the LCD. The student must step away before the next scan.

While this program is connected it sends the Arduino a heartbeat every second. When the heartbeat
stops (the program is closed, crashes, or you press **Disconnect**) the LCD shows
**NOT CONNECTED / Start the PC app** within 3 seconds, and no scan starts until it is connected again.

| Part | Pin |
|---|---|
| HC-SR04 ultrasonic | VCC 5V, GND, TRIG D9, ECHO D10 |
| 16x2 LCD with I2C backpack | VCC 5V, GND, SDA pin 20, SCL pin 21 (Mega) · SDA A4, SCL A5 (Uno/Nano) |

1. In the Arduino IDE install the library **LiquidCrystal I2C** (Frank de Brabander).
2. Open `arduino/srs_door/srs_door.ino`, pick your board (e.g. Arduino Mega or Mega 2560) and port, and upload.
   The LCD is found by itself at 0x27 or 0x3F. Blank screen: turn the contrast screw on the backpack.3. Close the Arduino IDE's Serial Monitor (only one program can use the port).
4. In this program's **Hardware** panel pick the port (e.g. `COM20  Arduino Mega 2560`) and press
   **Connect**. The choice is saved in `config.ini` (`serial_port`); **Disconnect** clears it.

### Hardware panel and test
The panel shows live: the port and sketch version, the **distance** (green when 25–50 cm), what the
door unit is doing (WAITING / HOLDING / SCANNING / …, and when a picture is allowed), whether the
**LCD** was found and at which address, the buzzer type and the Arduino's last message. The Device
panel shows the camera's frames per second and the size of the face in view.

**Test hardware** (any time) opens a window that checks, one by one, and marks each ✔ or ✖ with
what to check when it fails:
1. Arduino connected over USB · 2. door unit program answers (version 3) ·
3. LCD found on the I2C bus · 4. LCD shows the test screen (you answer Yes/No) ·
5. distance sensor gives readings · 6. it sees your hand at 25–50 cm.

Without an Arduino the program scans any face big enough on camera.
Serial messages (9600 baud, one per line) are listed at the top of `srs_door.ino`.

## Notes
* Matching uses SFace cosine similarity with threshold 0.40 (`MATCH_THRESHOLD` in `face_engine.py`). Raise it if strangers are ever accepted, lower it if enrolled students are denied.
* Each face is compared with *every* face stored on this PC, so a stranger is never "closest" to someone by elimination. The seat list does not decide entry: it only adds the seat to the banner (see the table above).
* **How often a decision is logged.** With the Arduino, every deliberate 1-second hold at the marker gets an answer and is logged. Without it, the same student is logged at most once every 15 seconds, a student who is already inside (or whose session ended) at most once a minute, and an unknown face once until it has left the picture for 2 seconds.
* **One face, one student.** Each student has exactly one embedding (`data/embeddings/<number>.json`; re-enrolling
  replaces it). A new enrolment is compared with every face stored on this PC (except the student's own); at or above
  `DUPLICATE_THRESHOLD` (0.40, the same as the door, in `face_engine.py`) it is rejected. `FaceStore.add` enforces the
  same rule, so a duplicate can never be saved, and at the door a face that matches two students is refused. What was
  compared is saved in the new embedding file under `duplicateCheck`. Only faces on *this* PC are compared: embeddings
  never leave it.
* At start-up and with `python srs_pc_app.py --check` the program lists any face stored for two students (for example
  enrolled before this rule), so the wrong one can be re-enrolled or deleted.

## Files
| File | What it does |
|---|---|
| `srs_pc_app.py` | The door program: server worker, camera + face worker, window (start this one) |
| `check_dependencies.py` | Checks and installs the packages and face models at start-up |
| `face_engine.py` | Face detection (YuNet), embeddings (SFace) and the faces stored on this PC |
| `arduino_link.py` | The serial connection to the Arduino door unit and the hardware test |
| `cameras.py` | Finding and opening webcams (used by the door program and `webcam_test.py`) |
| `download_models.py` | Downloads the two face models into `models/` (called by `check_dependencies.py`) |
| `webcam_test.py` | Shows one webcam on its own, to check it works |
| `arduino/srs_door/srs_door.ino` | The Arduino door unit's program |
| `config.example.ini` | Template for `config.ini` (created at the first start; holds the device key, not in git) |
