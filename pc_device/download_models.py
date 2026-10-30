"""download_models.py - fetch the two OpenCV Zoo face models into models/ (run once, ~39 MB).

Files come from the official https://github.com/opencv/opencv_zoo repository and are checked
against known SHA-256 hashes, so a broken or tampered download is refused.
"""
import hashlib
import urllib.request
from pathlib import Path

MODELS = Path(__file__).resolve().parent / "models"
ZOO = "https://github.com/opencv/opencv_zoo/raw/main/models"
FILES = {
    "face_detection_yunet_2023mar.onnx": (
        f"{ZOO}/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    ),
    "face_recognition_sface_2021dec.onnx": (
        f"{ZOO}/face_recognition_sface/face_recognition_sface_2021dec.onnx",
        "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
    ),
}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    MODELS.mkdir(exist_ok=True)
    for name, (url, digest) in FILES.items():
        target = MODELS / name
        if target.exists() and sha256(target) == digest:
            print(f"{name}: already here")
            continue
        print(f"{name}: downloading...")
        tmp = target.with_suffix(".part")
        urllib.request.urlretrieve(url, tmp)
        if sha256(tmp) != digest:
            tmp.unlink()
            raise SystemExit(f"{name}: checksum does not match, download refused")
        tmp.replace(target)
        print(f"{name}: OK")


if __name__ == "__main__":
    main()
