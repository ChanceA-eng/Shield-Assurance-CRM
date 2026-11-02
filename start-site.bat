@echo off
setlocal
title Shield Assurance CRM - Local Preview
cd /d "%~dp0"

echo ============================================
echo   Shield Assurance CRM - Local Preview
echo ============================================
echo.
echo Opens http://localhost:3000 without a production build.
echo Keep this window open while using the CRM.
echo Existing servers will not be stopped.
echo.

powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { Write-Host 'Port 3000 is already in use. No process was stopped.'; exit 1 }"
if errorlevel 1 (
  echo Open http://localhost:3000 if your CRM is already running.
  pause
  exit /b 1
)

start "" /min powershell -NoProfile -Command ^
  "$ProgressPreference='SilentlyContinue'; for($i=0;$i -lt 120;$i++){ try { $r=Invoke-WebRequest 'http://localhost:3000/login' -UseBasicParsing -TimeoutSec 3; if($r.StatusCode -eq 200){ Start-Process 'http://localhost:3000'; exit } } catch { Start-Sleep -Seconds 1 } }; Write-Host 'CRM did not become ready. Check the server window.'"

call corepack pnpm --filter @crm/web dev
if errorlevel 1 (
  echo.
  echo The local server stopped with an error. See the message above.
  pause
  exit /b 1
)
