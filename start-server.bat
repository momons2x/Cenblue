@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "URL=http://127.0.0.1:3000"
set "FOLDER=%~dp0"
if "%FOLDER:~-1%"=="\" set "FOLDER=%FOLDER:~0,-1%"

rem Flags: --no-editor skips VS Code, --prod serves the production build,
rem --rebuild forces a fresh production build (implies --prod).
set "OPEN_EDITOR=1"
set "PROD_MODE=0"
set "REBUILD=0"
:parse
if "%~1"=="" goto :parsed
if /i "%~1"=="--no-editor" set "OPEN_EDITOR=0"
if /i "%~1"=="--prod" set "PROD_MODE=1"
if /i "%~1"=="--rebuild" (
  set "PROD_MODE=1"
  set "REBUILD=1"
)
shift
goto :parse
:parsed

rem Already serving? Open the editor and get out without starting a second one.
curl -sf -o nul "%URL%/api/health" >nul 2>&1
if not errorlevel 1 (
  echo Cenblue server is already running on %URL%
  if "%OPEN_EDITOR%"=="1" call :open_editor
  exit /b 0
)

rem Open the editor first. Its dev-server task may bring the server up instead of us.
if "%OPEN_EDITOR%"=="1" call :open_editor

if "%PROD_MODE%"=="1" call :run_prod

echo Starting Cenblue server on %URL%
echo Press Ctrl+C in this window to stop it, or double-click stop-server.bat.
title Cenblue server
call pnpm dev
echo.
echo Cenblue server stopped.
exit /b 0

:run_prod
if "%REBUILD%"=="1" goto :build
if exist "apps\dashboard\.next\BUILD_ID" goto :serve
:build
echo Building Cenblue for production...
call pnpm build
if errorlevel 1 (
  echo Production build failed. Server not started.
  exit /b 1
)
:serve
echo Starting Cenblue production server on %URL%
echo Press Ctrl+C in this window to stop it, or double-click stop-server.bat.
title Cenblue server (production)
call pnpm start
echo.
echo Cenblue server stopped.
exit /b 0

:open_editor
set "CODECMD="
for /f "delims=" %%c in ('where code.cmd 2^>nul') do if not defined CODECMD set "CODECMD=%%c"
if not defined CODECMD set "CODECMD=%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd"
if not exist "%CODECMD%" set "CODECMD=%ProgramFiles%\Microsoft VS Code\bin\code.cmd"
if not exist "%CODECMD%" goto :no_editor

rem Launch Code.exe itself. "start" on a .cmd spawns cmd /K, which never exits.
for %%d in ("%CODECMD%") do set "BINDIR=%%~dpd"
if exist "%BINDIR%..\Code.exe" (
  start "" "%BINDIR%..\Code.exe" "%FOLDER%"
  exit /b 0
)
call "%CODECMD%" "%FOLDER%"
exit /b 0

:no_editor
echo VS Code was not found. Open this folder in your editor manually.
exit /b 0
