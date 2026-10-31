# PC door program (webcam face recognition)

`srs_pc_app.py` turns a Windows PC with a USB webcam into an SRS door device. It talks to the backend exactly like the ESP32-CAM would (see [`../Backend/DEVICE_API.md`](../Backend/DEVICE_API.md)), using [`../device_client/srs_client.py`](../device_client/srs_client.py).

| What happens | Where you see it |
|---|---|
| An invigilator presses **Start enrollment** on the web console | The PC window shows *ENROLLING name*, captures 5 shots when one face is close enough, then the Enroll page flips to **Enrolled** |
| A student walks up | **GRANTED name – seat N** if they have a seat in this venue's current exam session (09:00 before noon, 13:00 after), otherwise **DENIED** |
| Every decision | Appears on the Dashboard; queued on disk while offline and uploaded later (never twice) |

Face embeddings stay on this PC in `data/faces/`. The backend only stores the result and one photo for re-enrolment.

## Set up (once)
```
cd pc_device
pip install -r requirements.txt
python download_models.py          # two OpenCV Zoo models, ~39 MB, checksum-verified
copy config.example.ini config.ini # then fill in device_id and device_key
```
An **administrator** finds the device id and key on the device's page in the web console (Venues & Devices → Manage → Reveal). Invigilators cannot see keys.

## Run
```
python srs_pc_app.py --check       # tests URL + key + models, no camera
python srs_pc_app.py               # opens the door window
```
The window shows the camera top-right with the GRANTED / DENIED banner under it, and on the left the device and connection, the enrolment in progress (with a **Skip** button), the current exam session's seat list and an activity log. Close the window or press **Esc** to stop.

**Choosing the camera:** pick it from the **Camera** list under the video (press **Rescan** after plugging a webcam in). The choice is saved in `config.ini`. With `camera = auto` the highest-numbered camera is used, which is normally a USB webcam rather than the laptop's built-in one.

Options (or in `config.ini`): `--url`, `--device-id`, `--key`, `--camera 0` (default `auto`), `--serial COM3` (the Arduino door unit, see below), `--min-face 90` (pixels; raise it to make people step closer).

## Arduino door unit (optional): distance sensor, LCD and buzzer

`arduino/srs_door/srs_door.ino` (version 2) runs on an Arduino Mega, Uno or Nano. The student must stand 20–40 cm
from the sensor and hold still for **1 second**; only then does the Arduino beep and tell this
program to take the picture. The answer appears on the LCD with a beep (two rising tones = granted,
one long low tone = denied). The student must step away before the next scan.

| Part | Pin |
|---|---|
| HC-SR04 ultrasonic | VCC 5V, GND, TRIG D9, ECHO D10 |
| 16x2 LCD with I2C backpack | VCC 5V, GND, SDA pin 20, SCL pin 21 (Mega) · SDA A4, SCL A5 (Uno/Nano) |
| Buzzer (passive) | + D8, − GND |

1. In the Arduino IDE install the library **LiquidCrystal I2C** (Frank de Brabander).
2. Open `arduino/srs_door/srs_door.ino`, pick your board (e.g. Arduino Mega or Mega 2560) and port, and upload.
   The LCD is found by itself at 0x27 or 0x3F. Blank screen: turn the contrast screw on the backpack.
   Active buzzer (beeps by itself on 5V): set `PASSIVE_BUZZER` to `false`.
3. Close the Arduino IDE's Serial Monitor (only one program can use the port).
4. In this program's **Hardware** panel pick the port (e.g. `COM20  Arduino Mega 2560`) and press
   **Connect**. The choice is saved in `config.ini` (`serial_port`); **Disconnect** clears it.

### Hardware panel and test
The panel shows live: the port and sketch version, the **distance** (green when 20–40 cm), what the
door unit is doing (WAITING / HOLDING / SCANNING / …, and when a picture is allowed), whether the
**LCD** was found and at which address, and the Arduino's last message. The Device panel shows the
camera's frames per second and the size of the face in view.

**Test hardware** (any time) opens a window that checks, one by one, and marks each ✔ or ✖ with
what to check when it fails:
1. Arduino connected over USB · 2. door unit program answers (version 2) ·
3. LCD found on the I2C bus · 4. LCD shows the test screen (you answer Yes/No) ·
5. buzzer beeps (you answer) · 6. distance sensor gives readings · 7. it sees your hand at 20–40 cm.

Without an Arduino the program scans any face big enough on camera, as before.
Serial messages (9600 baud, one per line) are listed at the top of `srs_door.ino`.

## Notes
* Matching uses SFace cosine similarity with threshold 0.40 (`MATCH_THRESHOLD` in `face_engine.py`). Raise it if strangers are ever accepted, lower it if enrolled students are denied.
* Each face is compared with *every* face stored on this PC first, and only then checked against the seat list, so a stranger cannot be "closest" to a seated student by elimination.
* The same student is logged at most once every 15 seconds.
