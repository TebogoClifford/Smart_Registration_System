"""cameras.py - finding and opening webcams, shared by srs_pc_app.py and webcam_test.py."""
import os

try:
    import cv2
except ImportError:   # no OpenCV: no cameras (check_dependencies.py explains how to install it)
    cv2 = None


def open_camera(index):
    """Open a camera (DirectShow on Windows: it opens USB webcams much faster than the default)."""
    return cv2.VideoCapture(index, cv2.CAP_DSHOW) if os.name == "nt" else cv2.VideoCapture(index)


def list_cameras(max_index=6, skip=None):
    """[(index, width, height)] of the cameras that deliver a frame. `skip` = an index already open."""
    if cv2 is None:
        return []
    found = []
    for i in range(max_index):
        if i == skip:
            found.append((i, None, None))
            continue
        cam = open_camera(i)
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
