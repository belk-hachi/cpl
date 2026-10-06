@echo off
setlocal EnableExtensions
title CPL Extension Updater
cd /d "%~dp0"

echo.
echo ==========================================
echo        CPL Extension Updater
echo ==========================================
echo.
echo Downloading latest version from GitHub...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ProgressPreference = 'SilentlyContinue';" ^
  "$zip = Join-Path $env:TEMP 'cpl-update.zip';" ^
  "$tmpDir = Join-Path $env:TEMP ('cpl-update-' + (Get-Random));" ^
  "try {" ^
  "  Invoke-WebRequest -Uri 'https://github.com/belk-hachi/cpl/archive/refs/heads/main.zip' -OutFile $zip;" ^
  "  Write-Host 'Extracting update files...';" ^
  "  Expand-Archive -LiteralPath $zip -DestinationPath $tmpDir -Force;" ^
  "  $source = Get-ChildItem -Path $tmpDir -Directory | Select-Object -First 1;" ^
  "  if (-not $source) { throw 'Could not find extracted files.'; }" ^
  "  Write-Host 'Applying updates...';" ^
  "  Get-ChildItem -Path $source.FullName -Recurse | ForEach-Object {" ^
  "    $relative = $_.FullName.Substring($source.FullName.Length).TrimStart('\', '/');" ^
  "    $target = Join-Path (Get-Location).Path $relative;" ^
  "    if ($relative -match '^(update\.bat|\.gitignore|\.git|tests)($|[\\/])') { return; }" ^
  "    if ($_.PSIsContainer) {" ^
  "      if (-not (Test-Path -LiteralPath $target)) { [System.IO.Directory]::CreateDirectory($target) | Out-Null; }" ^
  "    } else {" ^
  "      Copy-Item -LiteralPath $_.FullName -Destination $target -Force;" ^
  "    }" ^
  "  };" ^
  "} catch {" ^
  "  Write-Error $_;" ^
  "  exit 1;" ^
  "} finally {" ^
  "  Remove-Item -Path $zip -Force -ErrorAction SilentlyContinue;" ^
  "  Remove-Item -Path $tmpDir -Recurse -Force -ErrorAction SilentlyContinue;" ^
  "}"

if errorlevel 1 (
    echo.
    echo ==========================================
    echo ERROR: Could not update the extension.
    echo Please check your internet connection and try again.
    echo ==========================================
    echo.
    pause
    exit /b 1
)

echo.
echo ==========================================
echo             UPDATE COMPLETE
echo ==========================================
echo.
echo Your CPL extension files are now updated!
echo.
echo FINAL STEP:
echo 1. Open your browser extensions page:
echo    Chrome: chrome://extensions
echo 2. Click the RELOAD button on the CPL Stock Check card.
echo.
pause
