@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Savedog Google 5MB Compressor
color 0A
cls

set "PROJECT_DIR=%~dp0"
set "TOOL_DIR=%PROJECT_DIR%tools\cocos-5mb-compressor"
set "INPUT=%~1"
set "OUTPUT=%PROJECT_DIR%build\super-html\google-5mb"
set "LOG=%PROJECT_DIR%build\super-html\compress-google-5mb.log"

if exist "%INPUT%" if not exist "%INPUT%\" if /I "%~x1"==".html" (
  call "%PROJECT_DIR%compress-html-5mb.bat" "%INPUT%"
  exit /b
)

if "%INPUT%"=="" set "INPUT=%PROJECT_DIR%build\super-html\google"

echo ============================================================
echo Savedog Google 5MB Compressor
echo ============================================================
echo.
echo Project: "%PROJECT_DIR%"
echo Input:   "%INPUT%"
echo Output:  "%OUTPUT%"
echo Log:     "%LOG%"
echo.

if not exist "%INPUT%\" (
  echo ERROR: Cannot find input folder:
  echo "%INPUT%"
  echo.
  pause
  exit /b 1
)

if not exist "%INPUT%\index.html" if not exist "%INPUT%\savedog_google.zip" if not exist "%INPUT%\*.zip" (
  echo ERROR: Cannot find index.html or google zip in:
  echo "%INPUT%"
  echo.
  echo Please build/export super-html google first.
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is required. Please install Node.js first.
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm is required. Please install Node.js with npm first.
  pause
  exit /b 1
)

if not exist "%TOOL_DIR%\node_modules\sharp" (
  echo Installing compressor dependencies, first run only...
  call npm.cmd install --prefix "%TOOL_DIR%"
  if errorlevel 1 (
    echo Dependency install failed.
    pause
    exit /b 1
  )
)

if not exist "%TOOL_DIR%\node_modules\ffmpeg-static\ffmpeg.exe" (
  echo Installing compressor dependencies, first run only...
  call npm.cmd install --prefix "%TOOL_DIR%"
  if errorlevel 1 (
    echo Dependency install failed.
    pause
    exit /b 1
  )
)

echo Compressing. Please wait...
echo.

node "%TOOL_DIR%\postprocess-super-html-google-5mb.js" --project "%PROJECT_DIR%." --input "%INPUT%" --output "%OUTPUT%" --replace > "%LOG%" 2>&1
set "RESULT=%ERRORLEVEL%"

type "%LOG%"

echo.
if not "%RESULT%"=="0" (
  echo ============================================================
  echo FAILED. See log:
  echo "%LOG%"
  echo ============================================================
  pause
  exit /b %RESULT%
)

echo ============================================================
echo DONE
echo Result folder:
echo "%PROJECT_DIR%build\super-html\google"
echo.
echo Submit zip:
echo "%PROJECT_DIR%build\super-html\google\savedog_google.zip"
echo.
echo Backup folders are created beside google before replacement.
echo ============================================================
pause
