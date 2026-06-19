@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required to run !Klein.
  echo Install it from https://nodejs.org/ or via winget, then run start.bat again.
  exit /b 1
)

for /f "usebackq delims=" %%A in (`node -p "Number(process.versions.node.split('.')[0])"`) do set "NODE_MAJOR=%%A"
if not defined NODE_MAJOR (
  echo Could not determine the installed Node.js version.
  exit /b 1
)

if %NODE_MAJOR% LSS 22 (
  echo Node.js 22 or newer is required. Found:
  node --version
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found on PATH. Reinstall Node.js with npm enabled, then run start.bat again.
  exit /b 1
)

where git >nul 2>nul
if errorlevel 1 (
  echo Git was not found on PATH. Install Git for Windows, then run start.bat again.
  exit /b 1
)

where docker >nul 2>nul
if errorlevel 1 (
  echo Warning: Docker was not found on PATH. !Klein can start, but agent tasks require Docker Desktop.
) else (
  docker info >nul 2>nul
  if errorlevel 1 (
    echo Warning: Docker Desktop is not reachable. Start Docker Desktop before running agent tasks.
  )
)

if not exist "node_modules\" goto install_deps
if not exist "web-ui\node_modules\" goto install_deps
if not exist "packages\desktop\node_modules\" goto install_deps
goto start_nklein

:install_deps
echo Installing dependencies ^(root, web-ui, desktop^)...
call npm run install:all
if errorlevel 1 exit /b %errorlevel%

:start_nklein
echo Starting !Klein in full dev mode...
call npm run dev:full
exit /b %errorlevel%
