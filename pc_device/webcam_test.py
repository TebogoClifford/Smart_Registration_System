
import cv2
import time


WINDOW_NAME = "SRS External Webcam Test"


def scan_cameras(max_indexes=10):
    """Find available cameras."""

    cameras = []

    print("\n========== SRS WEBCAM SCANNER ==========\n")

    for index in range(max_indexes):
        camera = cv2.VideoCapture(index, cv2.CAP_DSHOW)

        if not camera.isOpened():
            camera.release()
            continue

        time.sleep(0.5)

        success, frame = camera.read()

        if success and frame is not None:
            height, width = frame.shape[:2]

            print(f"Camera index: {index}")
            print(f"Resolution: {width} x {height}")
            print("--------------------------------")

            cameras.append(index)

        camera.release()

    return cameras


def test_selected_camera(index):
    """Test the selected USB webcam."""

    camera = cv2.VideoCapture(index, cv2.CAP_DSHOW)

    if not camera.isOpened():
        print("ERROR: Could not open selected camera.")
        return

    print(f"\nTesting camera index: {index}")
    print("Press Q or ESC to close.")
    print("You can also press Ctrl+C in PowerShell.\n")

    frame_count = 0
    start_time = time.time()
    fps = 0.0

    try:
        cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_NORMAL)

        while True:

            success, frame = camera.read()

            if not success:
                print("ERROR: Unable to read camera frame.")
                break

            height, width = frame.shape[:2]

            frame_count += 1
            elapsed = time.time() - start_time

            if elapsed >= 1:
                fps = frame_count / elapsed
                frame_count = 0
                start_time = time.time()

            cv2.putText(
                frame,
                f"Camera index: {index}",
                (10, 30),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (0, 255, 0),
                2
            )

            cv2.putText(
                frame,
                f"Resolution: {width} x {height}",
                (10, 60),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (0, 255, 0),
                2
            )

            cv2.putText(
                frame,
                f"FPS: {fps:.1f}",
                (10, 90),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (0, 255, 0),
                2
            )

            cv2.putText(
                frame,
                "Press Q or ESC to exit",
                (10, 120),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (255, 255, 255),
                2
            )

            cv2.imshow(WINDOW_NAME, frame)

            key = cv2.waitKey(10) & 0xFF

            if key in (ord("q"), ord("Q"), 27):
                print("Closing webcam...")
                break

            # Detect if the user closes the window using X.
            if cv2.getWindowProperty(
                WINDOW_NAME,
                cv2.WND_PROP_VISIBLE
            ) < 1:
                print("Webcam window closed.")
                break

    except KeyboardInterrupt:
        print("\nWebcam stopped by user.")

    except Exception as error:
        print(f"Webcam error: {error}")

    finally:
        camera.release()
        cv2.destroyAllWindows()

        # Process pending window events.
        for _ in range(5):
            cv2.waitKey(1)

        print("Webcam released successfully.")


def main():

    available = scan_cameras()

    if not available:
        print("No working cameras found.")
        return

    print("\nAvailable camera indexes:", available)

    try:
        selected = int(
            input("\nEnter your USB webcam index: ")
        )

        if selected not in available:
            print("Invalid camera index.")
            return

        test_selected_camera(selected)

    except ValueError:
        print("Please enter a valid camera number.")

    except KeyboardInterrupt:
        print("\nProgram cancelled.")


if __name__ == "__main__":
    main()
