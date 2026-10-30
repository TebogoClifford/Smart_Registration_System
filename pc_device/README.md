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
python srs_pc_app.py               # opens the camera window
```
Keys in the window: **Q**/**Esc** quit, **S** skip (fail) the current enrolment.

Options (or in `config.ini`): `--url`, `--device-id`, `--key`, `--camera 0` (default `auto`), `--serial COM3` (Arduino: receives `G` or `D` + newline), `--min-face 90` (pixels; raise it to make people step closer).

## Notes
* Matching uses SFace cosine similarity with threshold 0.40 (`MATCH_THRESHOLD` in `face_engine.py`). Raise it if strangers are ever accepted, lower it if enrolled students are denied.
* Each face is compared with *every* face stored on this PC first, and only then checked against the seat list, so a stranger cannot be "closest" to a seated student by elimination.
* The same student is logged at most once every 15 seconds.
