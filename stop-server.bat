@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "PORT=3000"
set "PIDFILE=%~dp0storage\temp\supervisor.pid"

rem Prefer the supervisor pid file: its tree owns both the dashboard and the pipeline.
if exist "%PIDFILE%" (
  set /p SUP_PID=<"%PIDFILE%"
  if defined SUP_PID (
    echo Stopping the Cenblue supervisor ^(pid !SUP_PID!^) ...
    taskkill /f /t /pid !SUP_PID! >nul 2>&1
  )
  del /q "%PIDFILE%"
  ping -n 3 127.0.0.1 >nul 2>&1
)

rem Fallback: kill whatever is listening on the dashboard port (pre-supervisor runs).
curl -sf -o nul "http://127.0.0.1:%PORT%/api/health" >nul 2>&1
if not errorlevel 1 (
  echo Stopping the Cenblue server on http://127.0.0.1:%PORT% ...
  for /f "tokens=5" %%p in ('netstat -ano ^| findstr /c:"127.0.0.1:%PORT% " ^| findstr "LISTENING"') do (
    taskkill /f /t /pid %%p >nul 2>&1
  )
  ping -n 3 127.0.0.1 >nul 2>&1
)

rem Fallback: kill orphaned pipeline workers that outlived their launcher.
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"CommandLine LIKE '%%pipeline.worker%%'\" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1

curl -sf -o nul "http://127.0.0.1:%PORT%/api/health" >nul 2>&1
if errorlevel 1 (
  echo Stopped.
) else (
  echo Still responding. Close the server window by hand.
)

exit /b 0
