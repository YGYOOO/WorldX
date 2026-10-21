@echo off
setlocal

set "PROJECT_DIR=%~dp0"
set "TOOL_DIR=%PROJECT_DIR%tools\cocos-5mb-compressor"
set "INPUT=%~1"

if "%INPUT%"=="" set "INPUT=%PROJECT_DIR%build\web-mobile"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Please install Node.js first.
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo npm is required. Please install Node.js with npm first.
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

node "%TOOL_DIR%\postprocess-web-mobile-5mb.js" --project "%PROJECT_DIR%." --input "%INPUT%" --output "%PROJECT_DIR%build\web-mobile-zip-5mb" --zip "%PROJECT_DIR%build\web-mobile-5mb.zip"

echo.
echo Result: %PROJECT_DIR%build\web-mobile-5mb.zip
pause
