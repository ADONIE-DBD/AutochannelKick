$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== AutochannelKick Vesktop Installer ==="
Write-Host ""

$VesktopInstaller = "$env:TEMP\Vesktop-Setup.exe"
$PluginsPath = "$env:APPDATA\vesktop\plugins\AutochannelKick"
$TempPlugin = "$env:TEMP\AutochannelKick"

Write-Host "Downloading Vesktop..."

$ReleaseApi = "https://api.github.com/repos/Vencord/Vesktop/releases/latest"
$Release = Invoke-RestMethod $ReleaseApi

$Asset = $Release.assets | Where-Object {
    $_.name -like "Vesktop-Setup-*.exe"
} | Select-Object -First 1

if (!$Asset) {
    Write-Host "Could not find Vesktop Windows installer."
    pause
    exit
}

Invoke-WebRequest -Uri $Asset.browser_download_url -OutFile $VesktopInstaller

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
