"""face_engine.py - face detection, face matching and the local face store for the PC device.

Uses the two OpenCV Zoo models (run download_models.py once to fetch them into models/):
  * YuNet  - finds faces and 5 landmarks (eyes, nose, mouth corners) in a frame.
  * SFace  - turns an aligned face into a 128-number "embedding". Two photos of the same
             person give embeddings that point the same way (high cosine similarity).

Embeddings stay on this PC (data/faces/<studentId>.npy), exactly like the ESP32 design:
the backend only ever learns "enrolled" / "failed" and the access decisions.
"""
import json
import os
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


class FaceStore:
    """The enrolled faces on this PC: one averaged embedding per student, saved as .npy files."""

    def __init__(self, folder):
        self.folder = Path(folder)
        self.folder.mkdir(parents=True, exist_ok=True)
        self.index_file = self.folder / "index.json"
        self.people = {}  # studentId -> {"studentNumber", "name", "embedding"}
        self._load()

    def _load(self):
        index = {}
        if self.index_file.exists():
            index = json.loads(self.index_file.read_text(encoding="utf-8"))
        for sid, meta in index.items():
            path = self.folder / f"{sid}.npy"
            if path.exists():
                self.people[int(sid)] = {**meta, "embedding": np.load(path)}

    def _save_index(self):
        index = {str(sid): {"studentNumber": p["studentNumber"], "name": p["name"]} for sid, p in self.people.items()}
        tmp = self.index_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(index, indent=2), encoding="utf-8")
        os.replace(tmp, self.index_file)

    def add(self, student_id, student_number, name, embeddings):
        mean = np.mean(np.stack(embeddings), axis=0)
        mean = mean / (np.linalg.norm(mean) + 1e-9)
        np.save(self.folder / f"{student_id}.npy", mean)
        self.people[int(student_id)] = {"studentNumber": student_number, "name": name, "embedding": mean}
        self._save_index()

    def keep_only(self, student_ids):
        """Delete every face whose student is no longer on this device's roster. Returns how many went."""
        keep = {int(s) for s in student_ids}
        gone = [sid for sid in self.people if sid not in keep]
        for sid in gone:
            self.people.pop(sid)
            (self.folder / f"{sid}.npy").unlink(missing_ok=True)
        if gone:
            self._save_index()
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
