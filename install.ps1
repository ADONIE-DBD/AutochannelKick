$Desktop = [Environment]::GetFolderPath("Desktop")
$VencordPath = Join-Path $Desktop "Vencord"
$PluginSource = Join-Path $PSScriptRoot "AutochannelKick"
$PluginDest = Join-Path $VencordPath "src\userplugins\AutochannelKick"

if (!(Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "Git is not installed. Install Git for Windows first."
    exit
}

if (!(Get-Command pnpm -ErrorAction SilentlyContinue)) {
    npm install -g pnpm
}

if (!(Test-Path $VencordPath)) {
    git clone https://github.com/Vendicated/Vencord.git $VencordPath
}

if (Test-Path $PluginDest) {
    Remove-Item $PluginDest -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $PluginDest | Out-Null
Copy-Item "$PluginSource\*" $PluginDest -Recurse -Force

Set-Location $VencordPath

pnpm install
pnpm build
pnpm inject

Write-Host "Done. Restart Discord, then enable AutochannelKick in Vencord plugins."
