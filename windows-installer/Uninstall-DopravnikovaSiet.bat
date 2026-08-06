@echo off
setlocal
echo Odinstalovavam Dopravnikovu siet...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
pause
