# YouTube Video Summarizer - Windows Installer
# This script installs the complete YouTube Video Summarizer system

$VERSION = "2.0.0"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "YouTube Video Summarizer Installer v$VERSION" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "This installer needs Administrator privileges." -ForegroundColor Yellow
    Write-Host "Please right-click and select 'Run as Administrator'" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Press any key to exit..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit
}

# Installation directory
$InstallDir = "$env:ProgramFiles\YouTubeSummarizer"
$VersionFile = "$InstallDir\version.txt"
$isUpgrade = $false
$oldVersion = "Unknown"

# Check for existing installation
if (Test-Path $InstallDir) {
    Write-Host "Existing installation detected!" -ForegroundColor Yellow
    
    if (Test-Path $VersionFile) {
        $oldVersion = Get-Content $VersionFile -Raw
        $oldVersion = $oldVersion.Trim()
        Write-Host "Current version: $oldVersion" -ForegroundColor Yellow
    }
    
    Write-Host "New version: $VERSION" -ForegroundColor Green
    Write-Host ""
    Write-Host "Choose an option:" -ForegroundColor Cyan
    Write-Host "  [U] Upgrade - Keep config, update files (Recommended)" -ForegroundColor White
    Write-Host "  [C] Clean Install - Remove everything and start fresh" -ForegroundColor White
    Write-Host "  [X] Cancel - Exit installer" -ForegroundColor White
    Write-Host ""
    
    $choice = Read-Host "Enter choice (U/C/X)"
    
    if ($choice -eq 'X' -or $choice -eq 'x') {
        Write-Host "Installation cancelled." -ForegroundColor Yellow
        exit
    }
    
    if ($choice -eq 'U' -or $choice -eq 'u') {
        $isUpgrade = $true
        Write-Host ""
        Write-Host "Upgrade Mode: Preserving your configuration..." -ForegroundColor Green
        
        # Backup config if it exists
        if (Test-Path "$InstallDir\backend\config.json") {
            Copy-Item "$InstallDir\backend\config.json" "$env:TEMP\yt-summary-config-backup.json" -Force
            Write-Host "Configuration backed up" -ForegroundColor Green
        }
        
        # Stop running services
        Write-Host "Stopping services..." -ForegroundColor Yellow
        Get-Process | Where-Object {
            $_.Path -like "*YouTubeSummarizer*"
        } | Stop-Process -Force -ErrorAction SilentlyContinue
        
        Start-Sleep -Seconds 2
    } else {
        # Clean install
        Write-Host ""
        Write-Host "Stopping services..." -ForegroundColor Yellow
        Get-Process | Where-Object {
            $_.Path -like "*YouTubeSummarizer*"
        } | Stop-Process -Force -ErrorAction SilentlyContinue
        
        Start-Sleep -Seconds 2
    }
}

Write-Host ""
Write-Host "Installation directory: $InstallDir" -ForegroundColor Green
if ($isUpgrade) {
    Write-Host "Mode: Upgrade from v$oldVersion" -ForegroundColor Cyan
} else {
    Write-Host "Mode: Fresh Installation" -ForegroundColor Cyan
}
Write-Host ""

# Step 1: Check for Python
Write-Host "[1/7] Checking for Python..." -ForegroundColor Yellow

$pythonExe = $null

try {
    $pythonVersion = & python --version 2>&1
    if ($pythonVersion -match "Python 3") {
        Write-Host "Python found: $pythonVersion" -ForegroundColor Green
        $pythonExe = "python"
    }
} catch {
    # Python not found
}

if (-not $pythonExe) {
    Write-Host "Python 3.8+ not found. Installing Python..." -ForegroundColor Yellow
    
    $pythonInstaller = "$env:TEMP\python-installer.exe"
    $pythonUrl = "https://www.python.org/ftp/python/3.11.7/python-3.11.7-amd64.exe"
    
    Write-Host "Downloading Python 3.11.7..." -ForegroundColor Gray
    Invoke-WebRequest -Uri $pythonUrl -OutFile $pythonInstaller
    
    Write-Host "Installing Python..." -ForegroundColor Gray
    Start-Process -FilePath $pythonInstaller -ArgumentList "/quiet InstallAllUsers=1 PrependPath=1" -Wait
    
    Remove-Item $pythonInstaller
    
    # Refresh environment variables
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    
    Write-Host "Python installed" -ForegroundColor Green
    $pythonExe = "python"
}

Write-Host ""

# Step 2: Create installation directory
Write-Host "[2/7] Creating installation directory..." -ForegroundColor Yellow

try {
    if (Test-Path $InstallDir) {
        if (-not $isUpgrade) {
            Write-Host "Cleaning previous installation..." -ForegroundColor Gray
            Remove-Item -Path $InstallDir -Recurse -Force
        }
    }
    
    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }
    New-Item -ItemType Directory -Path "$InstallDir\backend" -Force | Out-Null
    New-Item -ItemType Directory -Path "$InstallDir\systray" -Force | Out-Null
    New-Item -ItemType Directory -Path "$InstallDir\extension" -Force | Out-Null
    
    Write-Host "Installation directory ready" -ForegroundColor Green
} catch {
    Write-Host "Failed to create installation directory: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Step 3: Copy files
Write-Host "[3/7] Copying application files..." -ForegroundColor Yellow

try {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $scriptDir = Split-Path -Parent $scriptDir
    
    Copy-Item -Path "$scriptDir\backend\*" -Destination "$InstallDir\backend\" -Recurse -Force
    Copy-Item -Path "$scriptDir\systray\*" -Destination "$InstallDir\systray\" -Recurse -Force
    Copy-Item -Path "$scriptDir\extension\*" -Destination "$InstallDir\extension\" -Recurse -Force
    
    Write-Host "Files copied successfully" -ForegroundColor Green
} catch {
    Write-Host "Failed to copy files: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Step 4: Create Python virtual environment
Write-Host "[4/7] Setting up Python environment..." -ForegroundColor Yellow

try {
    Set-Location "$InstallDir\backend"
    
    Write-Host "Creating virtual environment..." -ForegroundColor Gray
    & $pythonExe -m venv venv
    
    $venvPython = "$InstallDir\backend\venv\Scripts\python.exe"
    $venvPip = "$InstallDir\backend\venv\Scripts\pip.exe"
    
    Write-Host "Installing backend dependencies..." -ForegroundColor Gray
    & $venvPip install --upgrade pip | Out-Null
    & $venvPip install -r requirements.txt | Out-Null
    
    Set-Location "$InstallDir\systray"
    
    Write-Host "Installing system tray dependencies..." -ForegroundColor Gray
    & $venvPip install -r requirements.txt | Out-Null
    
    Write-Host "Python environment configured" -ForegroundColor Green
} catch {
    Write-Host "Failed to set up Python environment: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Step 5: Create startup shortcut
Write-Host "[5/7] Creating startup shortcut..." -ForegroundColor Yellow

try {
    $startupFolder = [Environment]::GetFolderPath("Startup")
    $shortcutPath = "$startupFolder\YouTube Summarizer.lnk"
    
    $WScriptShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WScriptShell.CreateShortcut($shortcutPath)
    $Shortcut.TargetPath = "$InstallDir\backend\venv\Scripts\pythonw.exe"
    $Shortcut.Arguments = "`"$InstallDir\systray\tray_app.py`""
    $Shortcut.WorkingDirectory = "$InstallDir\systray"
    $Shortcut.Description = "YouTube Video Summarizer System Tray"
    $Shortcut.Save()
    
    Write-Host "Startup shortcut created" -ForegroundColor Green
} catch {
    Write-Host "Could not create startup shortcut: $_" -ForegroundColor Yellow
}

Write-Host ""

# Step 6: Create Start Menu shortcuts
Write-Host "[6/7] Creating Start Menu shortcuts..." -ForegroundColor Yellow

try {
    $startMenuFolder = "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\YouTube Summarizer"
    New-Item -ItemType Directory -Path $startMenuFolder -Force | Out-Null
    
    # System Tray App shortcut
    $shortcut1 = "$startMenuFolder\YouTube Summarizer.lnk"
    $WScriptShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WScriptShell.CreateShortcut($shortcut1)
    $Shortcut.TargetPath = "$InstallDir\backend\venv\Scripts\pythonw.exe"
    $Shortcut.Arguments = "`"$InstallDir\systray\tray_app.py`""
    $Shortcut.WorkingDirectory = "$InstallDir\systray"
    $Shortcut.Description = "YouTube Video Summarizer"
    $Shortcut.Save()
    
    # Extension folder shortcut
    $shortcut2 = "$startMenuFolder\Extension Folder.lnk"
    $Shortcut = $WScriptShell.CreateShortcut($shortcut2)
    $Shortcut.TargetPath = "$InstallDir\extension"
    $Shortcut.Description = "Chrome Extension Files"
    $Shortcut.Save()
    
    # Create uninstaller script
    $uninstallScript = "$InstallDir\uninstall.ps1"
$uninstallContent = @'
# YouTube Video Summarizer - Uninstaller
Write-Host "========================================" -ForegroundColor Red
Write-Host "YouTube Video Summarizer - Uninstaller" -ForegroundColor Red
Write-Host "========================================" -ForegroundColor Red
Write-Host ""

$confirm = Read-Host "Are you sure you want to uninstall? (Y/N)"
if ($confirm -ne 'Y' -and $confirm -ne 'y') {
    Write-Host "Uninstall cancelled." -ForegroundColor Green
    Start-Sleep -Seconds 2
    exit
}

Write-Host ""
Write-Host "Uninstalling..." -ForegroundColor Yellow

# Stop processes
Write-Host "[1/4] Stopping services..." -ForegroundColor Yellow
Get-Process | Where-Object {$_.Path -like "*YouTubeSummarizer*"} | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "Done" -ForegroundColor Green

# Remove startup shortcut
Write-Host "[2/4] Removing startup shortcut..." -ForegroundColor Yellow
$startupShortcut = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\YouTube Summarizer.lnk"
if (Test-Path $startupShortcut) {
    Remove-Item $startupShortcut -Force
}
Write-Host "Done" -ForegroundColor Green

# Remove Start Menu folder
Write-Host "[3/4] Removing Start Menu shortcuts..." -ForegroundColor Yellow
$startMenuFolder = "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\YouTube Summarizer"
if (Test-Path $startMenuFolder) {
    Remove-Item $startMenuFolder -Recurse -Force
}
Write-Host "Done" -ForegroundColor Green

# Remove installation directory
Write-Host "[4/4] Removing installation files..." -ForegroundColor Yellow
Start-Sleep -Seconds 2
$installDir = "$env:ProgramFiles\YouTubeSummarizer"
if (Test-Path $installDir) {
    Remove-Item $installDir -Recurse -Force
}
Write-Host "Done" -ForegroundColor Green

Write-Host ""
Write-Host "Uninstallation Complete!" -ForegroundColor Green
Write-Host "Please manually remove the Chrome extension from chrome://extensions/" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press any key to close..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
'@
    
    Set-Content -Path $uninstallScript -Value $uninstallContent -Encoding UTF8
    
    # Uninstall shortcut
    $shortcut3 = "$startMenuFolder\Uninstall.lnk"
    $Shortcut = $WScriptShell.CreateShortcut($shortcut3)
    $Shortcut.TargetPath = "powershell.exe"
    $Shortcut.Arguments = "-ExecutionPolicy Bypass -File `"$uninstallScript`""
    $Shortcut.Description = "Uninstall YouTube Video Summarizer"
    $Shortcut.Save()
    
    Write-Host "Start Menu shortcuts created" -ForegroundColor Green
} catch {
    Write-Host "Could not create Start Menu shortcuts: $_" -ForegroundColor Yellow
}

Write-Host ""

# Step 7: Restore config and write version
if ($isUpgrade -and (Test-Path "$env:TEMP\yt-summary-config-backup.json")) {
    Write-Host "[UPGRADE] Restoring your configuration..." -ForegroundColor Cyan
    try {
        Copy-Item "$env:TEMP\yt-summary-config-backup.json" "$InstallDir\backend\config.json" -Force
        Remove-Item "$env:TEMP\yt-summary-config-backup.json" -Force
        Write-Host "Your API key and settings have been preserved" -ForegroundColor Green
    } catch {
        Write-Host "Could not restore configuration: $_" -ForegroundColor Yellow
    }
    Write-Host ""
}

Write-Host "Writing version information..." -ForegroundColor Gray
$VERSION | Out-File -FilePath "$InstallDir\version.txt" -Encoding UTF8 -NoNewline

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
if ($isUpgrade) {
    Write-Host "Upgrade Complete! ($oldVersion -> $VERSION)" -ForegroundColor Green
} else {
    Write-Host "Installation Complete!" -ForegroundColor Green
}
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. The system tray app will start in a moment" -ForegroundColor White
Write-Host "2. Look for the blue 'YT' icon in your system tray" -ForegroundColor White
Write-Host "3. Right-click and select 'Configure...' to set your API key" -ForegroundColor White
Write-Host "4. Install the Chrome extension from:" -ForegroundColor White
Write-Host "   $InstallDir\extension" -ForegroundColor Gray
Write-Host ""
Write-Host "Press any key to start the application..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

# Start the tray app
Start-Process -FilePath "$InstallDir\backend\venv\Scripts\pythonw.exe" -ArgumentList "`"$InstallDir\systray\tray_app.py`"" -WindowStyle Hidden

Write-Host "Application started!" -ForegroundColor Green
Write-Host "Look for the blue 'YT' icon in your system tray." -ForegroundColor Cyan
