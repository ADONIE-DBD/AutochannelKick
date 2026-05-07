```powershell
$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== AutochannelKick Installer ==="
Write-Host ""

# ----------------------------
# REQUIRED PROGRAM CHECKS
# ----------------------------

if (!(Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "Git is not installed."
    Write-Host "Install it here:"
    Write-Host "https://git-scm.com/download/win"
    pause
    exit
}

if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "Node.js is not installed."
    Write-Host "Install Node.js LTS here:"
    Write-Host "https://nodejs.org"
    pause
    exit
}

# ----------------------------
# ENABLE SCRIPT EXECUTION
# ----------------------------

try {
    Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force
} catch {}

# ----------------------------
# INSTALL PNPM
# ----------------------------

if (!(Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "Installing pnpm..."
    npm install -g pnpm
}

# ----------------------------
# PATHS
# ----------------------------

$VencordPath = "C:\Vencord"
$TempPath = Join-Path $env:TEMP "AutochannelKick"
$PluginPath = Join-Path $VencordPath "src\userplugins\AutochannelKick"

# ----------------------------
# CLEAN TEMP
# ----------------------------

if (Test-Path $TempPath) {
    Remove-Item $TempPath -Recurse -Force
}

# ----------------------------
# DOWNLOAD VENCORD
# ----------------------------

if (!(Test-Path $VencordPath)) {
    Write-Host ""
    Write-Host "Downloading Vencord..."
    git clone https://github.com/Vendicated/Vencord.git $VencordPath
}

# ----------------------------
# DOWNLOAD PLUGIN
# ----------------------------

Write-Host ""
Write-Host "Downloading AutochannelKick..."

git clone https://github.com/ADONIE-DBD/AutochannelKick.git $TempPath

# ----------------------------
# INSTALL PLUGIN
# ----------------------------

if (Test-Path $PluginPath) {
    Remove-Item $PluginPath -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $PluginPath | Out-Null

Copy-Item "$TempPath\AutochannelKick\*" $PluginPath -Recurse -Force

# ----------------------------
# BUILD VENCORD
# ----------------------------

Set-Location $VencordPath

Write-Host ""
Write-Host "Installing dependencies..."
pnpm install

Write-Host ""
Write-Host "Building Vencord..."
pnpm build

Write-Host ""
Write-Host "Injecting Discord..."
pnpm inject

Write-Host ""
Write-Host "================================="
Write-Host "INSTALL COMPLETE"
Write-Host "================================="
Write-Host ""
Write-Host "Restart Discord."
Write-Host ""
Write-Host "Enable:"
Write-Host "Settings -> Vencord -> Plugins -> AutochannelKick"
Write-Host ""

pause
```
