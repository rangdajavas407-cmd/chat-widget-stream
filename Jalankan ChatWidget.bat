
@echo off
setlocal
title ChatWidgetStudio
cd /d "%~dp0"

set "NODE_DIR=C:\Users\User\Downloads\node-v22.22.0-win-x64"
set "NODE_EXE=%NODE_DIR%\node.exe"
set "NPM_CLI=%NODE_DIR%\node_modules\npm\bin\npm-cli.js"

echo ========================================
echo       CHAT WIDGET STUDIO
echo ========================================
echo.

if not exist "%NODE_EXE%" (
    echo [ERROR] node.exe tidak ditemukan:
    echo %NODE_EXE%
    pause
    exit /b 1
)

if not exist "%NPM_CLI%" (
    echo [ERROR] npm-cli.js tidak ditemukan:
    echo %NPM_CLI%
    pause
    exit /b 1
)

set "PATH=%NODE_DIR%;%PATH%"

echo [INFO] Memeriksa Node.js...
"%NODE_EXE%" -v
if errorlevel 1 goto error

echo.
echo [INFO] Memeriksa npm...
"%NODE_EXE%" "%NPM_CLI%" -v
if errorlevel 1 goto error

if not exist "package.json" (
    echo.
    echo [ERROR] package.json tidak ditemukan.
    echo Pastikan start.bat berada di folder utama proyek.
    goto error
)

if not exist "node_modules" (
    echo.
    echo [INFO] Menginstal dependencies...
    "%NODE_EXE%" "%NPM_CLI%" install
    if errorlevel 1 goto error
)

echo.
echo [INFO] Menjalankan ChatWidgetStudio...
"%NODE_EXE%" "%NPM_CLI%" start
if errorlevel 1 goto error

goto selesai

:error
echo.
echo [ERROR] Proses gagal. Periksa pesan di atas.
pause
exit /b 1

:selesai
echo.
echo ChatWidgetStudio telah berhenti.
pause
