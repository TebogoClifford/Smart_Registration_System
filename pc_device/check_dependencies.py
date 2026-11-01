"""check_dependencies.py - make sure everything the door program needs is installed (runs at start-up).

srs_pc_app.py and webcam_test.py call ensure_dependencies() before they import anything else, so a
fresh PC only needs Python: the first start installs the packages in requirements.txt (pip) and
downloads the two face models (download_models.py). Nothing happens when everything is already there.

It NEVER stops the program: when something cannot be installed (no internet, no pip, no rights) it
prints what is missing and how to fix it, and the door program starts anyway with what it has
(see "Without a dependency" in README.md).

Run it on its own to set up or repair a PC:
  python check_dependencies.py              check and install what is missing
  python check_dependencies.py --check      only report, install nothing
Skip the install at start-up with  python srs_pc_app.py --no-install
"""
import importlib
import importlib.metadata
import importlib.util
import re
import site
import subprocess
import sys
from pathlib import Path

# Only the standard library above this line: this file must run before any package is installed.

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:            # so download_models.py is found from any folder
    sys.path.insert(0, str(HERE))
REQUIREMENTS = HERE / "requirements.txt"

# pip package name -> the name you import (only where they differ)
IMPORT_NAMES = {"opencv-python": "cv2", "pyserial": "serial"}
# installed under another name, these also provide the import (e.g. OpenCV with the extra modules)
ALTERNATIVES = {"opencv-python": ("opencv-contrib-python", "opencv-python-headless", "opencv-contrib-python-headless")}
# what stops working without each package (shown when it cannot be installed)
WITHOUT = {
    "opencv-python": "no camera picture, no enrolment, no face recognition",
    "numpy": "no camera picture, no enrolment, no face recognition",
    "requests": "no connection to the server: decisions are queued on this PC until it is installed",
    "pyserial": "no Arduino door unit (the program scans faces without it)",
}
PIP_TIMEOUT = 600   # seconds for the whole pip run (OpenCV is about 40 MB)


def say(text):
    print(f"[setup] {text}", flush=True)


# ---------------------------------------------------------------- requirements.txt
def read_requirements(path=REQUIREMENTS):
    """[(pip name, minimum version or None, full requirement line)] from requirements.txt."""
    reqs = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()          # drop comments
        if not line:
            continue
        m = re.match(r"^([A-Za-z0-9_.-]+)\s*(?:>=\s*([0-9][0-9.]*))?", line)
        if m:
            reqs.append((m.group(1), m.group(2), line))
    return reqs


def _version_tuple(text):
    """'4.10.0.84' -> (4, 10, 0, 84); stops at the first part that is not a number."""
    parts = []
    for p in text.split("."):
        if not p.isdigit():
            break
        parts.append(int(p))
    return tuple(parts)


def _installed_version(pip_name):
    """Installed version of the package (or of an alternative that provides the same import), or None."""
    for name in (pip_name, *ALTERNATIVES.get(pip_name, ())):
        try:
            return importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            continue
    return None


def problem_with(pip_name, minimum):
    """Why this requirement is not met ('not installed', 'version 4.5 is older than 4.8'), or None when it is."""
    module = IMPORT_NAMES.get(pip_name, pip_name)
    if importlib.util.find_spec(module) is None:
        return "not installed"
    version = _installed_version(pip_name)
    if minimum and version and _version_tuple(version) < _version_tuple(minimum):
        return f"version {version} is older than {minimum}"
    return None


# ---------------------------------------------------------------- installing
def _pip(args):
    """Run pip with this same Python. True when it worked."""
    cmd = [sys.executable, "-m", "pip", *args]
    try:
        return subprocess.run(cmd, timeout=PIP_TIMEOUT).returncode == 0
    except (OSError, subprocess.TimeoutExpired) as err:
        say(f"pip did not finish: {err}")
        return False


def _have_pip():
    if importlib.util.find_spec("pip") is not None:
        return True
    say("pip is missing; trying to add it (python -m ensurepip)...")
    try:
        subprocess.run([sys.executable, "-m", "ensurepip", "--upgrade"], timeout=PIP_TIMEOUT, check=True)
    except (OSError, subprocess.SubprocessError) as err:
        say(f"could not add pip: {err}")
        return False
    importlib.invalidate_caches()
    return importlib.util.find_spec("pip") is not None


def _refresh_import_paths():
    """Let this running program import what pip just installed, without a restart."""
    user_site = site.getusersitepackages()          # a first 'pip install --user' creates this folder
    if Path(user_site).is_dir() and user_site not in sys.path:
        site.addsitedir(user_site)
    importlib.invalidate_caches()


def install(lines):
    """pip install the requirement lines (short timeout and one retry, so an offline PC does not hang)."""
    if not _have_pip():
        return False
    say("installing: " + " ".join(lines))
    ok = _pip(["install", "--disable-pip-version-check", "--timeout", "20", "--retries", "1", *lines])
    _refresh_import_paths()
    return ok


# ---------------------------------------------------------------- face models and Tkinter
def missing_models():
    """Names of the face model files that are not in models/ yet."""
    try:
        from download_models import FILES, MODELS
    except Exception:  # noqa: BLE001 - this check must never stop the program
        return []
    return [name for name in FILES if not (MODELS / name).exists()]


def download_models():
    """Run download_models.py (checksum-verified). True when both models are there afterwards."""
    try:
        import download_models as dm
        dm.main()
    except (Exception, SystemExit) as err:  # noqa: BLE001 - no internet, checksum refused, ...
        say(f"face models could not be downloaded: {err}")
    return not missing_models()


def tkinter_problem():
    """Tkinter comes with Python on Windows; pip cannot install it, so only explain the fix."""
    if importlib.util.find_spec("tkinter") is not None:
        return None
    if sys.platform.startswith("linux"):
        return "Tkinter is missing: sudo apt install python3-tk"
    if sys.platform == "darwin":
        return "Tkinter is missing: brew install python-tk (or use the installer from python.org)"
    return "Tkinter is missing: re-run the python.org installer and tick 'tcl/tk and IDLE'"


# ---------------------------------------------------------------- the start-up check
def ensure_dependencies(install_missing=True, models=True, window=True):
    """Check (and, unless install_missing=False, install) everything the door program needs.

    Never raises. Returns a list of problems that are still there afterwards, as readable lines
    ("requests: not installed - no connection to the server ..."); an empty list means all is ready.
    models=False skips the face models, window=False skips the Tkinter check (for webcam_test.py)."""
    problems = []
    try:
        reqs = read_requirements()
    except OSError as err:
        say(f"cannot read {REQUIREMENTS.name}: {err}")
        reqs = []

    # 1. Python packages
    todo = [(name, line) for name, minimum, line in reqs if problem_with(name, minimum)]
    if todo and install_missing:
        say(f"{len(todo)} package(s) missing or too old: " + ", ".join(n for n, _ in todo))
        if not install([line for _, line in todo]):
            say("pip reported a problem; the program starts with what is installed")
    for name, minimum, _ in reqs:
        why = problem_with(name, minimum)
        if why:
            problems.append(f"{name}: {why} - {WITHOUT.get(name, 'some features will not work')}"
                            f" (fix: {Path(sys.executable).name} -m pip install -r requirements.txt)")

    # 2. the two face models (~39 MB, once)
    if models and missing_models():
        say("face models missing: " + ", ".join(missing_models()))
        if install_missing:
            download_models()
        if missing_models():
            problems.append("face models missing - no enrolment or face recognition (fix: python download_models.py)")

    # 3. Tkinter (the window)
    if window:
        tk = tkinter_problem()
        if tk:
            problems.append(f"{tk} - the program runs without its window (console only)")

    for p in problems:
        say("NOT READY: " + p)
    if not problems:
        say("all dependencies are ready")
    return problems


if __name__ == "__main__":
    left = ensure_dependencies(install_missing="--check" not in sys.argv[1:])
    sys.exit(1 if left else 0)
