"""face_engine.py - face detection, face matching and the local face store for the PC device.

Uses the two OpenCV Zoo models (run download_models.py once to fetch them into models/):
  * YuNet  - finds faces and 5 landmarks (eyes, nose, mouth corners) in a frame.
  * SFace  - turns an aligned face into a 128-number "embedding". Two photos of the same
             person give embeddings that point the same way (high cosine similarity).

Each enrolled student gets two files on this PC, named by student number:
  data/photos/<student number>.jpg        - the enrolment photo
  data/embeddings/<student number>.json   - the face embedding (128 numbers) and who it belongs to
The embedding never leaves this PC, exactly like the ESP32 design: the backend only learns
"enrolled" / "failed", the enrolment photo and the access decisions.
"""
import json
import os
import re
import time
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
MODELS = HERE / "models"
DETECTOR_MODEL = MODELS / "face_detection_yunet_2023mar.onnx"
RECOGNIZER_MODEL = MODELS / "face_recognition_sface_2021dec.onnx"

# SFace's published cosine threshold is 0.363; a little higher = fewer false accepts at an exam door.
MATCH_THRESHOLD = 0.40


class FaceEngine:
    def __init__(self, score_threshold=0.85):
        for m in (DETECTOR_MODEL, RECOGNIZER_MODEL):
            if not m.exists():
                raise FileNotFoundError(f"{m.name} is missing. Run:  python download_models.py")
        self.detector = cv2.FaceDetectorYN.create(str(DETECTOR_MODEL), "", (320, 320), score_threshold)
        self.recognizer = cv2.FaceRecognizerSF.create(str(RECOGNIZER_MODEL), "")
        self._size = None

    def detect(self, frame):
        """Return the faces in a BGR frame as rows [x, y, w, h, 10 landmark values, score], biggest first."""
        h, w = frame.shape[:2]
        if self._size != (w, h):
            self.detector.setInputSize((w, h))
            self._size = (w, h)
        _, faces = self.detector.detect(frame)
        if faces is None:
            return []
        return sorted(faces, key=lambda f: f[2] * f[3], reverse=True)

    def embed(self, frame, face):
        """128-number embedding of one detected face (normalised to length 1)."""
        aligned = self.recognizer.alignCrop(frame, face)
        feat = self.recognizer.feature(aligned).flatten().astype(np.float32)
        return feat / (np.linalg.norm(feat) + 1e-9)


def _file_name(student_number):
    """A student number as a safe file name (letters, digits, - and _ only)."""
    return re.sub(r"[^A-Za-z0-9_-]", "_", str(student_number)) or "unknown"


def _write_atomic(path, data):
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


class FaceStore:
    """The enrolled faces on this PC: per student one photo (data/photos) and one embedding (data/embeddings)."""

    def __init__(self, data_folder):
        data = Path(data_folder)
        self.photos = data / "photos"
        self.embeddings = data / "embeddings"
        self.photos.mkdir(parents=True, exist_ok=True)
        self.embeddings.mkdir(parents=True, exist_ok=True)
        self.people = {}  # studentId -> {"studentNumber", "name", "embedding"}
        self._migrate_old(data / "faces")
        self._load()

    def _load(self):
        for path in sorted(self.embeddings.glob("*.json")):
            try:
                rec = json.loads(path.read_text(encoding="utf-8"))
                emb = np.asarray(rec["embedding"], dtype=np.float32)
                self.people[int(rec["studentId"])] = {"studentNumber": rec["studentNumber"], "name": rec["name"], "embedding": emb}
            except (ValueError, KeyError, TypeError) as err:
                print(f"skipping unreadable embedding file {path.name}: {err}")

    def _migrate_old(self, old):
        """Older versions kept data/faces/<studentId>.npy + index.json; turn those into the new files once."""
        index_file = old / "index.json"
        if not index_file.exists():
            return
        try:
            index = json.loads(index_file.read_text(encoding="utf-8") or "{}")
        except ValueError:
            index = {}
        for sid, meta in index.items():
            npy = old / f"{sid}.npy"
            if npy.exists():
                self._write_embedding(int(sid), meta["studentNumber"], meta["name"], np.load(npy), samples=None)
                npy.unlink()
        index_file.unlink()

    def _write_embedding(self, student_id, student_number, name, embedding, samples):
        rec = {
            "studentId": int(student_id), "studentNumber": str(student_number), "name": name,
            "model": "SFace (OpenCV Zoo, face_recognition_sface_2021dec)", "samples": samples,
            "enrolledAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "embedding": [round(float(v), 6) for v in embedding],
        }
        _write_atomic(self.embeddings / f"{_file_name(student_number)}.json", json.dumps(rec, indent=2).encode("utf-8"))

    def photo_path(self, student_number):
        return self.photos / f"{_file_name(student_number)}.jpg"

    def add(self, student_id, student_number, name, embeddings, photo_jpg=None):
        """Save a new enrolment: the averaged embedding (JSON) and, if given, the photo (JPEG bytes)."""
        mean = np.mean(np.stack(embeddings), axis=0)
        mean = mean / (np.linalg.norm(mean) + 1e-9)
        # the same student enrolled again under a changed number: drop the old files first
        old = self.people.get(int(student_id))
        if old and old["studentNumber"] != str(student_number):
            self._delete_files(old["studentNumber"])
        self._write_embedding(student_id, student_number, name, mean, samples=len(embeddings))
        if photo_jpg:
            _write_atomic(self.photo_path(student_number), photo_jpg)
        self.people[int(student_id)] = {"studentNumber": str(student_number), "name": name, "embedding": mean}

    def _delete_files(self, student_number):
        (self.embeddings / f"{_file_name(student_number)}.json").unlink(missing_ok=True)
        self.photo_path(student_number).unlink(missing_ok=True)

    def keep_only(self, student_ids):
        """Delete every face whose student is no longer on this device's roster. Returns how many went."""
        keep = {int(s) for s in student_ids}
        gone = [sid for sid in self.people if sid not in keep]
        for sid in gone:
            self._delete_files(self.people.pop(sid)["studentNumber"])
        return len(gone)

    def best_match(self, embedding, allowed_ids=None):
        """(studentId, similarity) of the closest enrolled face, or (None, best similarity) below the threshold."""
        best_id, best = None, -1.0
        for sid, p in self.people.items():
            if allowed_ids is not None and sid not in allowed_ids:
                continue
            sim = float(np.dot(embedding, p["embedding"]))
            if sim > best:
                best_id, best = sid, sim
        return (best_id, best) if best >= MATCH_THRESHOLD else (None, best)
