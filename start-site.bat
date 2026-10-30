@echo off
title Shield Assurance CRM
cd /d "%~dp0"

echo ============================================
echo   Shield Assurance CRM
echo ============================================
echo.

echo [1/3] Stopping any previous CRM server...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 0 } | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }" >nul 2>&1
timeout /t 2 /nobreak >nul

echo [2/3] Building the latest version (about a minute)...
call corepack pnpm --filter @crm/web build
if errorlevel 1 (
  echo.
  echo Build failed - see errors above. Nothing was started.
  pause
  exit /b 1
)

echo.
echo [3/3] Starting the site... your browser opens when it is ready.
echo Keep this window open. Press Ctrl+C or close it to stop the site.
echo.

start "" /min powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "for($i=0;$i -lt 120;$i++){ try { (New-Object Net.Sockets.TcpClient('localhost',3000)).Close(); Start-Process 'http://localhost:3000'; exit } catch { Start-Sleep -Seconds 1 } }"

corepack pnpm --filter @crm/web start
