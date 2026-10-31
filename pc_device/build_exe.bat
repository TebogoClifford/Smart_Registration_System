@echo off
rem build_exe.bat - builds dist\SRS Door.exe: the whole PC door program in one file.
rem Copy only that file to a door PC (no Python needed there). On its first start it writes
rem config.ini next to itself; fill in device_id and device_key, then start it again.
cd /d "%~dp0"

python -m pip install -r requirements.txt pyinstaller || goto :error
python download_models.py || goto :error

python -m PyInstaller --noconfirm --clean --onefile --windowed --name "SRS Door" ^
  --paths ..\device_client ^
  --add-data "models\face_detection_yunet_2023mar.onnx;models" ^
  --add-data "models\face_recognition_sface_2021dec.onnx;models" ^
  --add-data "config.example.ini;." ^
  srs_pc_app.py || goto :error

echo.
echo Built: %~dp0dist\SRS Door.exe
exit /b 0

:error
echo.
echo Build FAILED.
exit /b 1
