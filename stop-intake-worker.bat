@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0apps\web\scripts\local-intake-worker.ps1" -Action Stop
if errorlevel 1 pause
