@echo off
setlocal
title Shield Assurance CRM - Local Preview
cd /d "%~dp0"

echo ============================================
echo   Shield Assurance CRM - Local Preview
echo ============================================
echo.
echo Opens the CRM without a production build.
echo Keep this window open while using the CRM.
echo Existing servers will not be stopped.
echo.

powershell -NoProfile -File "%~dp0start-site.ps1"
if not errorlevel 1 exit /b 0
echo.
echo The CRM launcher stopped. See the message above.
pause
exit /b 1
