@echo off
setlocal
cd /d "%~dp0"
if not exist "runtime\node.exe" (
  echo runtime\node.exe is missing. Unzip the package again.
  pause
  exit /b 1
)
if not exist "data\local.db" (
  echo data\local.db is missing. Unzip the package again.
  pause
  exit /b 1
)
"runtime\node.exe" "scripts\start-portable.mjs"
if errorlevel 1 pause
endlocal
