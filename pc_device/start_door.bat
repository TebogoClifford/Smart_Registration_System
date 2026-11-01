@echo off
rem start_door.bat - double-click this to start the SRS door program.
rem   1. finds a working Python 3.9+ (the "python" Microsoft Store shortcut does not count)
rem   2. if there is none, installs Python 3.12 from python.org for this user (no admin rights needed)
rem   3. starts srs_pc_app.py, which installs the packages and face models it needs (check_dependencies.py)
rem Extra options are passed on, e.g.:  start_door.bat --check
setlocal
cd /d "%~dp0"

call :find_python
if not defined PY (
    echo Python is not installed on this PC. Installing Python 3.12 for this user, this takes a few minutes...
    call :install_python
    call :find_python
)
if not defined PY (
    echo.
    echo Python could not be installed automatically.
    echo Install it from https://www.python.org/downloads/ - tick "Add python.exe to PATH" - then start this again.
    pause
    exit /b 1
)

echo Using Python: %PY%
%PY% srs_pc_app.py %*
if errorlevel 1 pause
exit /b %errorlevel%


rem ---------------------------------------------------------------- find Python
:find_python
set "PY="
call :try py -3
if not defined PY call :try python
if not defined PY call :try python3
rem a fresh install is not on PATH in this window yet, so also look where python.org installs it
if not defined PY for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*" "%ProgramFiles%\Python3*") do (
    if not defined PY if exist "%%~D\python.exe" call :try "%%~D\python.exe"
)
exit /b

:try
rem works only if it really runs Python 3.9 or newer (the Store shortcut fails with exit code 9009)
%* -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >nul 2>&1 || exit /b
set PY=%*
exit /b


rem ---------------------------------------------------------------- install Python
:install_python
set "PY_URL=https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe"
set "PY_SETUP=%TEMP%\python-3.12.10-amd64.exe"
echo Downloading %PY_URL%
curl.exe -L --fail -o "%PY_SETUP%" "%PY_URL%" 2>nul || powershell -NoProfile -Command "Invoke-WebRequest -Uri '%PY_URL%' -OutFile '%PY_SETUP%'"
if exist "%PY_SETUP%" (
    rem /quiet = no questions; per user; adds python to PATH; with Tkinter for the window, pip and the py launcher
    start "" /wait "%PY_SETUP%" /quiet InstallAllUsers=0 PrependPath=1 Include_tcltk=1 Include_pip=1 Include_launcher=1
    del "%PY_SETUP%" >nul 2>&1
    exit /b
)
echo Download failed; trying winget instead...
winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements
exit /b
