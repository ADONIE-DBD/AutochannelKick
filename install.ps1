$Desktop = [Environment]::GetFolderPath("Desktop")
$VencordPath = Join-Path $Desktop "Vencord"
$PluginDest = Join-Path $VencordPath "src\userplugins\AutochannelKick"
$Temp = Join-Path $env:TEMP "AutochannelKick"

if (!(Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "Git is required. Install Git for Windows first: https://git-scm.com/download/win"
    exit
}

if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js is required. Install Node.js LTS first: https://nodejs.org"
    exit
}

if (!(Get-Command pnpm -ErrorAction SilentlyContinue)) {
    npm install -g pnpm
}

if (!(Test-Path $VencordPath)) {
    git clone https://github.com/Vendicated/Vencord.git $VencordPath
}

if (Test-Path $Temp) {
    Remove-Item $Temp -Recurse -Force
}

git clone https://github.com/ADONIE-DBD/AutochannelKick.git $Temp

if (Test-Path $PluginDest) {
    Remove-Item $PluginDest -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $PluginDest | Out-Null
Copy-Item "$Temp\AutochannelKick\*" $PluginDest -Recurse -Force

Set-Location $VencordPath

pnpm install
pnpm build
pnpm inject

Write-Host ""
Write-Host "Done. Restart Discord, then enable AutochannelKick in Vencord plugins."
