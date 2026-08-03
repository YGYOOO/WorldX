@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Cocos HTML 5MB Compressor
color 0A
cls

set "PROJECT_DIR=%~dp0"
set "TOOL_DIR=%PROJECT_DIR%tools\cocos-5mb-compressor"
set "INPUT=%~1"

if "%INPUT%"=="" (
  echo Please drag a Cocos exported HTML file onto this BAT file.
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

echo Compressing "%INPUT%". Please wait...
echo.
node "%TOOL_DIR%\compress-html-5mb.js" --project "%PROJECT_DIR%." --input "%INPUT%"
set "RESULT=%ERRORLEVEL%"

echo.
if not "%RESULT%"=="0" (
  echo ============================================================
  echo FAILED. The original HTML was not changed.
  echo ============================================================
  pause
  exit /b %RESULT%
)

echo ============================================================
echo DONE. Compressed HTML and ZIP files were written beside the original.
echo ============================================================
pause
