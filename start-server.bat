@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "URL=http://127.0.0.1:3000"
set "FOLDER=%~dp0"
if "%FOLDER:~-1%"=="\" set "FOLDER=%FOLDER:~0,-1%"

rem Pass --no-editor to skip launching VS Code (used by the logon shortcut).
set "OPEN_EDITOR=1"
if /i "%~1"=="--no-editor" set "OPEN_EDITOR=0"

rem Already serving? Open the editor and get out without starting a second one.
curl -sf -o nul "%URL%/api/health" >nul 2>&1
if not errorlevel 1 (
  echo Cenblue server is already running on %URL%
  if "%OPEN_EDITOR%"=="1" call :open_editor
  exit /b 0
)

rem Open the editor first. Its dev-server task may bring the server up instead of us.
if "%OPEN_EDITOR%"=="1" call :open_editor

echo Starting Cenblue server on %URL%
echo Press Ctrl+C in this window to stop it, or double-click stop-server.bat.
title Cenblue server
pnpm dev
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
