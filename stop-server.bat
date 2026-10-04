@echo off
setlocal EnableExtensions
set "PORT=3000"

curl -sf -o nul "http://127.0.0.1:%PORT%/api/health" >nul 2>&1
if errorlevel 1 (
  echo No Cenblue server is responding on http://127.0.0.1:%PORT%.
  exit /b 0
)

echo Stopping the Cenblue server on http://127.0.0.1:%PORT% ...

rem Kill the listener together with pnpm, next and every child process.
rem The parent shells notice their child is gone and exit, so the console closes itself.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /c:"127.0.0.1:%PORT% " ^| findstr "LISTENING"') do (
  taskkill /f /t /pid %%p >nul 2>&1
)

ping -n 3 127.0.0.1 >nul 2>&1

curl -sf -o nul "http://127.0.0.1:%PORT%/api/health" >nul 2>&1
if errorlevel 1 (
  echo Stopped.
) else (
  echo Still responding. Close the server window by hand.
)

exit /b 0
