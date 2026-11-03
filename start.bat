@echo off
setlocal
cd /d "%~dp0"

where powershell >nul 2>&1
if errorlevel 1 (
  echo PowerShell was not found. WeiDu's Windows launcher needs Windows PowerShell.
  echo You can still start it from a terminal after installing Node.js LTS:
  echo   npm install ^&^& npm run dev
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
set "code=%ERRORLEVEL%"
if not "%code%"=="0" (
  echo.
  echo WeiDu stopped. Read the message above.
  echo If it says Node.js is not installed, install the LTS build from https://nodejs.org/ and double-click start.bat again.
  pause
  exit /b %code%
)
exit /b 0
