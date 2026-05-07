$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== AutochannelKick Vesktop Installer ==="
Write-Host ""

$VesktopInstaller = "$env:TEMP\Vesktop-Setup.exe"
$PluginsPath = "$env:APPDATA\vesktop\plugins\AutochannelKick"
$TempPlugin = "$env:TEMP\AutochannelKick"

if (!(Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "Git is required. Install Git first:"
    Write-Host "https://git-scm.com/download/win"
    pause
    exit
}

Write-Host "Downloading Vesktop..."
Invoke-WebRequest `
    -Uri "https://github.com/Vencord/Vesktop/releases/latest/download/Vesktop-Setup.exe" `
    -OutFile $VesktopInstaller

Write-Host "Installing Vesktop..."
Start-Process $VesktopInstaller -Wait

Write-Host "Creating plugin folder..."
New-Item -ItemType Directory -Force -Path $PluginsPath | Out-Null

if (Test-Path $TempPlugin) {
    Remove-Item $TempPlugin -Recurse -Force
}

Write-Host "Downloading AutochannelKick..."
git clone https://github.com/ADONIE-DBD/AutochannelKick.git $TempPlugin

Write-Host "Installing plugin..."
Copy-Item "$TempPlugin\AutochannelKick\*" $PluginsPath -Recurse -Force

Write-Host ""
Write-Host "Done."
Write-Host "Restart Vesktop."
Write-Host "Then enable AutochannelKick in Settings -> Vencord -> Plugins."
Write-Host ""

pause
