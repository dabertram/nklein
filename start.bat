@echo off
rem Thin wrapper — all launch logic (arg parsing, env preflight, stale-instance detection, start) lives in the single
rem cross-platform Node launcher start.mjs (node:util.parseArgs). This script only ensures Node is present, then hands off.
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required to run !Klein.
  echo Install it from https://nodejs.org/ or via winget, then run start.bat again.
  exit /b 1
)

node "%~dp0start.mjs" %*
exit /b %errorlevel%
