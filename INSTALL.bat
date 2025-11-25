@echo off
REM YouTube Video Summarizer - Easy Installer Launcher
REM This batch file makes it easy to run the PowerShell installer

echo ========================================
echo YouTube Video Summarizer - Installer
echo ========================================
echo.
echo This will install the YouTube Video Summarizer system.
echo.
echo NOTE: You need Administrator privileges to install.
echo If prompted, click "Yes" to allow the installer to run.
echo.
pause

REM Check for admin privileges
net session >nul 2>&1
if %errorLevel% == 0 (
    echo Running with Administrator privileges...
    echo.
) else (
    echo Requesting Administrator privileges...
    echo.
    REM Re-launch as administrator
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

REM Run the PowerShell installer
echo Starting PowerShell installer...
echo.
powershell -ExecutionPolicy Bypass -File "%~dp0installer\install.ps1"

echo.
echo Press any key to close...
pause >nul
