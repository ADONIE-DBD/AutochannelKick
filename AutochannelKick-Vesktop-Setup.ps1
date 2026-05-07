$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== AutochannelKick Vesktop Source Installer ==="
Write-Host ""

if (!(Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "Git is required: https://git-scm.com/download/win"
    pause
    exit
}

if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js LTS is required: https://nodejs.org"
    pause
    exit
}

if (!(Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "Installing pnpm..."
    npm install -g pnpm
}

$VesktopPath = "C:\Vesktop"
$PluginTemp = "$env:TEMP\AutochannelKick"
$PluginDest = "$VesktopPath\src\userplugins\AutochannelKick"

if (!(Test-Path $VesktopPath)) {
    Write-Host "Downloading Vesktop source..."
    git clone https://github.com/Vencord/Vesktop.git $VesktopPath
}

if (Test-Path $PluginTemp) {
    Remove-Item $PluginTemp -Recurse -Force
}

Write-Host "Downloading AutochannelKick..."
git clone https://github.com/ADONIE-DBD/AutochannelKick.git $PluginTemp

Write-Host "Installing plugin into src/userplugins..."
if (Test-Path $PluginDest) {
    Remove-Item $PluginDest -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $PluginDest | Out-Null
Copy-Item "$PluginTemp\AutochannelKick\*" $PluginDest -Recurse -Force

Set-Location $VesktopPath

Write-Host "Installing dependencies..."
pnpm install

Write-Host "Building Vesktop..."
pnpm build

Write-Host "Starting Vesktop source build..."
pnpm start

Write-Host ""
Write-Host "Done. Enable AutochannelKick in Settings -> Vencord -> Plugins."
pause
