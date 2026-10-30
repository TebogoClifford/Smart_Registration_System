"""simulator.py - plays the PC program's part against the real backend, with no camera or Arduino.

Use it to check that the web console and the backend work with a Python client before you
plug in the webcam. It is the Python twin of Backend/tools/device-simulator.js.

    pip install requests
    python simulator.py --url http://localhost:3000 --device-id 1 --key <key from the device page>
    python simulator.py ... --watch        # keep polling for enrolments, like the real program will

Environment variables BASE_URL, DEVICE_ID and DEVICE_KEY work too.
"""
import argparse
import os
import time

from srs_client import SrsClient, SrsError

# A few bytes that look like the start of a JPEG; the real program sends the webcam frame.
FAKE_JPEG = bytes([0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 0x4A, 0x46, 0x49, 0x46, 0, 1, 0xFF, 0xD9])


def handle_pending(client):
    """Pick up students the invigilator started and pretend the capture worked."""
    pending = client.pending_enrollments()
    for s in pending:
        print(f"   capturing {s['studentNumber']} ({s['name']})")
        client.upload_enrollment_image(s["studentId"], FAKE_JPEG)
        client.report_enrollment(s["studentId"], ok=True)
    if not pending:
        print("   nothing waiting")
    return len(pending)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--url", default=os.environ.get("BASE_URL", "http://localhost:3000"))
    p.add_argument("--device-id", default=os.environ.get("DEVICE_ID"))
    p.add_argument("--key", default=os.environ.get("DEVICE_KEY"))
    p.add_argument("--watch", action="store_true", help="keep polling for enrolments until Ctrl+C")
    args = p.parse_args()
    if not args.device_id or not args.key:
        p.error("set --device-id and --key (copy the key from the device page in the web console)")

    client = SrsClient(args.url, args.device_id, args.key)
    print("1. waiting for the backend")
    client.wait_until_up()
    print("2. config:", client.config())
    print("3. heartbeat:", client.heartbeat())
    print("4. pending enrolments")
    handle_pending(client)

    print("5. exam session (who may enter now)")
    session = client.session()
    print(f"   {session['date']} {session['slot']}: {len(session['students'])} seated student(s)")

    print("6. door scans, uploaded as one batch")
    events = [client.make_event("granted", s["studentId"], seconds_ago=30 - i * 10)
              for i, s in enumerate([x for x in session["students"] if x["onThisDevice"]][:3])]
    events.append(client.make_event("denied", seconds_ago=5))   # unknown face / no seat
    for r in client.send_batch(events):
        print("  ", r)
    print("7. same batch again (the server must say 'duplicate', not store it twice)")
    for r in client.send_batch(events):
        print("  ", r)

    if args.watch:
        interval = client.config()["enrollmentPollSeconds"]
        print(f"watching for enrolments every {interval} s (Ctrl+C to stop)")
        while True:
            try:
                client.heartbeat()
                handle_pending(client)
            except SrsError as err:
                print("  problem:", err)
            time.sleep(interval)


if __name__ == "__main__":
    main()
