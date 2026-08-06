@echo off
setlocal
echo Instalujem Dopravnikovu siet...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if errorlevel 1 (
  echo.
  echo Instalacia zlyhala. Skontroluj hlasenia vyssie.
  pause
  exit /b 1
)
pause
