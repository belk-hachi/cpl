@echo off
setlocal EnableExtensions

title CPL Extension Updater

REM GitHub repository
set "REPO=https://github.com/belk-hachi/cpl/archive/refs/heads/main.zip"

REM This BAT file must stay inside the extension folder.
set "INSTALL_DIR=%~dp0"

echo.
echo ==========================================
echo        CPL Extension Updater
echo ==========================================
echo.
echo Downloading latest version from GitHub...
echo.

set "ZIP=%TEMP%\cpl-update.zip"
set "TMP=%TEMP%\cpl-update-%RANDOM%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '%REPO%' -OutFile '%ZIP%'"

if errorlevel 1 (
    echo.
    echo ERROR: Could not download the latest version.
    echo Check your internet connection and try again.
    pause
    exit /b 1
)

echo Extracting update...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Expand-Archive -LiteralPath '%ZIP%' -DestinationPath '%TMP%' -Force"

if errorlevel 1 (
    echo.
    echo ERROR: Could not extract the update.
    del "%ZIP%" >nul 2>&1
    pause
    exit /b 1
)

REM Find the extracted GitHub folder.
for /d %%D in ("%TMP%\cpl-*") do set "SOURCE_DIR=%%D"

if not defined SOURCE_DIR (
    echo.
    echo ERROR: Could not find extracted extension files.
    rmdir /s /q "%TMP%" >nul 2>&1
    del "%ZIP%" >nul 2>&1
    pause
    exit /b 1
)

echo Updating extension files...

REM Copy the new version over the existing files.
REM Existing files not present in the new version are removed first,
REM except this updater itself.
for /f "delims=" %%F in ('dir /b /a-d "%INSTALL_DIR%" 2^>nul') do (
    if /I not "%%F"=="%~nx0" del /q "%INSTALL_DIR%%%F" >nul 2>&1
)

for /d %%D in ("%INSTALL_DIR%*") do (
    if /I not "%%~nxD"=="%TMP%" rmdir /s /q "%%D" >nul 2>&1
)

xcopy "%SOURCE_DIR%\*" "%INSTALL_DIR%" /E /I /H /Y >nul

if errorlevel 1 (
    echo.
    echo ERROR: Could not copy the updated files.
    rmdir /s /q "%TMP%" >nul 2>&1
    del "%ZIP%" >nul 2>&1
    pause
    exit /b 1
)

REM Restore the updater because the previous cleanup removed everything except it.
copy /y "%~f0" "%INSTALL_DIR%%~nx0" >nul

rmdir /s /q "%TMP%" >nul 2>&1
del "%ZIP%" >nul 2>&1

echo.
echo ==========================================
echo        UPDATE COMPLETED
echo ==========================================
echo.
echo Your CPL extension files are now updated.
echo.
echo IMPORTANT:
echo Open Chrome/Edge extensions and click RELOAD
echo on the CPL extension.
echo.
echo Chrome: chrome://extensions
echo Edge:   edge://extensions
echo.
pause
