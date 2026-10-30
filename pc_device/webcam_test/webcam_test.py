
import cv2
import time


def find_working_camera(max_indexes=5):
    """Find the first camera that successfully returns a video frame."""

    print("Searching for connected cameras...")

    for index in range(max_indexes):
        print(f"Testing camera index {index}...")

        camera = cv2.VideoCapture(index, cv2.CAP_DSHOW)

        if not camera.isOpened():
            camera.release()
            continue

        # Allow the webcam a moment to initialise.
        time.sleep(1)

        success, frame = camera.read()

        if success and frame is not None:
            height, width = frame.shape[:2]

            print(f"\nCamera found at index: {index}")
            print(f"Resolution: {width} x {height}")

            return camera, index

        camera.release()

    return None, None


def main():
    camera, camera_index = find_working_camera()

    if camera is None:
        print("\nERROR: No working webcam was found.")
        print("Check that the webcam is connected.")
        print("Close applications that might be using the camera.")
        return

    print("\nWebcam test started.")
    print("Press Q or ESC to close the camera window.\n")

    frame_count = 0
    start_time = time.time()
    measured_fps = 0.0

    while True:
        success, frame = camera.read()

        if not success:
            print("ERROR: Could not read a frame from the webcam.")
            break

        height, width = frame.shape[:2]
        frame_count += 1

        elapsed = time.time() - start_time

        if elapsed >= 1:
            measured_fps = frame_count / elapsed
            frame_count = 0
            start_time = time.time()

        # Display camera information.
        cv2.putText(
            frame,
            f"Camera index: {camera_index}",
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
            f"Measured FPS: {measured_fps:.1f}",
            (10, 90),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (0, 255, 0),
            2
        )

        cv2.imshow("SRS PC Device - Webcam Test", frame)

        key = cv2.waitKey(1) & 0xFF

        if key == ord("q") or key == 27:
            break

    camera.release()
    cv2.destroyAllWindows()

    print("\nWebcam test completed.")


if __name__ == "__main__":
    main()
