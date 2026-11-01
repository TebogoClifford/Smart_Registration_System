"""webcam_test.py - check the webcams on their own, without the door program or the server.

Lists every camera that delivers a picture, then shows the one you pick with its resolution and
frames per second. Press Q or Esc (or close the window) to stop.

  python webcam_test.py
"""
import sys
import time

from check_dependencies import ensure_dependencies

ensure_dependencies(models=False, window=False)   # only OpenCV is needed here

from cameras import cv2, list_cameras, open_camera  # noqa: E402

WINDOW = "SRS webcam test"
GREEN, WHITE = (0, 255, 0), (255, 255, 255)


def show_camera(index):
    """Show camera `index` live until Q / Esc or the window is closed."""
    cam = open_camera(index)
    if not cam.isOpened():
        print(f"Camera #{index} could not be opened.")
        return
    print(f"Showing camera #{index}. Press Q or Esc to stop.")
    cv2.namedWindow(WINDOW, cv2.WINDOW_NORMAL)
    frames, since, fps = 0, time.time(), 0.0
    try:
        while True:
            ok, frame = cam.read()
            if not ok:
                print("The camera stopped sending pictures.")
                break
            frames += 1
            if time.time() - since >= 1:                       # frames per second, updated every second
                fps, frames, since = frames / (time.time() - since), 0, time.time()
            h, w = frame.shape[:2]
            lines = [(f"Camera #{index}", GREEN), (f"{w} x {h}", GREEN), (f"{fps:.1f} frames/s", GREEN),
                     ("Q or Esc to stop", WHITE)]
            for n, (text, color) in enumerate(lines):
                cv2.putText(frame, text, (10, 30 * (n + 1)), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
            cv2.imshow(WINDOW, frame)
            if cv2.waitKey(10) & 0xFF in (ord("q"), ord("Q"), 27):
                break
            if cv2.getWindowProperty(WINDOW, cv2.WND_PROP_VISIBLE) < 1:   # closed with the X
                break
    except KeyboardInterrupt:
        pass
    finally:
        cam.release()
        cv2.destroyAllWindows()
        cv2.waitKey(1)


def main():
    if cv2 is None:
        sys.exit("OpenCV is not installed: pip install -r requirements.txt")
    print("Looking for cameras...")
    cams = list_cameras(max_index=10)
    if not cams:
        sys.exit("No working camera found. Plug in the webcam and try again.")
    for i, w, h in cams:
        print(f"  camera #{i}: {w} x {h}" + ("   (probably the built-in one)" if i == 0 and len(cams) > 1 else ""))
    try:
        pick = int(input(f"Camera to show [{cams[-1][0]}]: ") or cams[-1][0])
    except ValueError:
        sys.exit("Please type one of the camera numbers.")
    except (KeyboardInterrupt, EOFError):
        return
    if pick not in [i for i, _, _ in cams]:
        sys.exit(f"There is no camera #{pick}.")
    show_camera(pick)


if __name__ == "__main__":
    main()
