@echo off
title Faislabadi POS
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Please install the LTS version from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies, please wait...
  call npm install --no-audit --no-fund
)

start "" cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:3000"
echo Faislabadi POS is starting on http://localhost:3000
echo Keep this window open while using the POS. Close it to stop the POS.
node server.js
pause
