@echo off
title MTGStream
cd /d "%~dp0"

:: NOTE: this script uses `goto` rather than parenthesised if-blocks on purpose.
:: cmd.exe ends an `if (` block at the first unescaped `)` it meets -- including
:: one inside an echo, e.g. "(LTS version)". That silently pushes the rest of the
:: block OUT of the branch, so it runs every time regardless of the condition.
:: That exact bug made this script always open the Node download page.

:: -- Check for Node.js -----------------------------------------
where node >nul 2>&1
if errorlevel 1 goto no_node

:: -- Check Node is v18 or newer --------------------------------
for /f "delims=" %%v in ('node -e "process.stdout.write(process.versions.node.split('.')[0])"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 18 goto old_node

:: -- Install dependencies (first run only) ---------------------
if exist node_modules goto launch
echo First-time setup: installing dependencies...
echo This only happens once per machine.
call npm install --omit=dev
echo.

:launch
echo Starting MTGStream on http://localhost:3001
echo Press Ctrl+C to stop.
echo.

:: Open the control panel once the server has had a moment to boot
start "" /B cmd /C "timeout /T 2 /NOBREAK >nul && start http://localhost:3001"

node server/index.js
pause
exit /b 0

:no_node
echo.
echo Node.js is required to run MTGStream.
echo Please install the LTS version from https://nodejs.org
echo then run start.bat again.
echo.
start "" "https://nodejs.org/en/download"
pause
exit /b 1

:old_node
echo.
echo Node.js 18 or newer is required.
node --version
echo Please update from https://nodejs.org then run start.bat again.
echo.
start "" "https://nodejs.org/en/download"
pause
exit /b 1
