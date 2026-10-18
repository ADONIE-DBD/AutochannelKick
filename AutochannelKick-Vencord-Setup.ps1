param(
    [string]$VencordPath = 'C:\Vencord',
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Program failed with exit code $LASTEXITCODE. Installation stopped."
    }
}

function Find-Program {
    param([string[]]$Names)
    foreach ($name in $Names) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($command) { return $command.Source }
    }
    return $null
}

function Get-NodeMajorVersion {
    param([string]$Program)
    # --version avoids JavaScript string quoting across PowerShell versions.
    $versionOutput = & $Program --version
    if ($LASTEXITCODE -ne 0) {
        throw "Node.js version detection failed with exit code $LASTEXITCODE."
    }
    $versionText = ($versionOutput | Out-String).Trim()
    if ($versionText -notmatch '^v(?<Major>\d+)\.\d+\.\d+(?:[-+].*)?$') {
        throw "Could not read the Node.js version: $versionText"
    }
    return [int]$Matches['Major']
}

$originalLocation = Get-Location
$downloadDirectory = $null

try {
    Write-Host "`n=== AutochannelKick Installer ===`n"
    $gitProgram = Find-Program -Names @('git.exe', 'git')
    $nodeProgram = Find-Program -Names @('node.exe', 'node')
    if (!$gitProgram) { throw 'Install Git first: https://git-scm.com/download/win' }
    if (!$nodeProgram) { throw 'Install Node.js LTS first: https://nodejs.org' }

    $nodeMajor = Get-NodeMajorVersion -Program $nodeProgram
    if ($nodeMajor -lt 22) { throw 'Vencord requires Node.js 22 or newer. Install Node.js LTS.' }

    $VencordPath = [IO.Path]::GetFullPath($VencordPath)
    if (!(Test-Path -LiteralPath $VencordPath)) {
        Write-Host 'Downloading the newest Vencord source...'
        Invoke-Checked -Program $gitProgram -Arguments @('clone', '--branch', 'main', 'https://github.com/Vendicated/Vencord.git', $VencordPath)
    } else {
        if (!(Test-Path -LiteralPath (Join-Path $VencordPath '.git'))) {
            throw "$VencordPath exists but is not a Vencord Git checkout. Nothing was overwritten."
        }
        $branch = & $gitProgram -C $VencordPath branch --show-current
        if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') {
            throw 'The existing Vencord checkout must be on main before this installer can update it.'
        }
        $trackedChanges = & $gitProgram -C $VencordPath status --porcelain --untracked-files=no
        if ($LASTEXITCODE -ne 0 -or $trackedChanges) {
            throw 'The Vencord checkout has tracked edits. Save those edits before updating; they were preserved.'
        }
        Write-Host 'Updating Vencord to the newest main...'
        Invoke-Checked -Program $gitProgram -Arguments @('-C', $VencordPath, 'pull', '--ff-only', 'origin', 'main')
    }

    # Use the plugin included beside this script when available. This allows
    # the downloaded update package to install its exact plugin version.
    $pluginSource = $null
    if ($PSScriptRoot) {
        $bundledPlugin = Join-Path $PSScriptRoot 'AutochannelKick'
        if (Test-Path -LiteralPath (Join-Path $bundledPlugin 'index.tsx')) {
            $pluginSource = $bundledPlugin
        }
    }
    if (!$pluginSource) {
        $downloadDirectory = Join-Path ([IO.Path]::GetTempPath()) ('AutochannelKick-' + [guid]::NewGuid().ToString('N'))
        Write-Host 'Downloading AutochannelKick...'
        Invoke-Checked -Program $gitProgram -Arguments @('clone', '--depth', '1', 'https://github.com/ADONIE-DBD/AutochannelKick.git', $downloadDirectory)
        $pluginSource = Join-Path $downloadDirectory 'AutochannelKick'
    }
    if (!(Test-Path -LiteralPath (Join-Path $pluginSource 'index.tsx'))) {
        throw 'The plugin download does not contain AutochannelKick/index.tsx.'
    }

    $pluginPath = Join-Path $VencordPath 'src\userplugins\AutochannelKick'
    if (Test-Path -LiteralPath $pluginPath) {
        $backupRoot = Join-Path $VencordPath 'autochannel-backups'
        New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
        $backupPath = Join-Path $backupRoot ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N'))
        Copy-Item -LiteralPath $pluginPath -Destination $backupPath -Recurse
        Write-Host "Previous plugin backed up to $backupPath"
    }
    New-Item -ItemType Directory -Path $pluginPath -Force | Out-Null
    Get-ChildItem -LiteralPath $pluginSource -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $pluginPath -Recurse -Force
    }

    $package = Get-Content -LiteralPath (Join-Path $VencordPath 'package.json') -Raw | ConvertFrom-Json
    $packageManager = [string]$package.packageManager
    if ($packageManager -notmatch '^pnpm@(\d+\.\d+\.\d+)') { throw 'Vencord does not specify a supported pnpm version.' }
    $requiredPnpmVersion = $Matches[1]
    $pnpmProgram = Find-Program -Names @('pnpm.cmd', 'pnpm.exe', 'pnpm')
    $installedPnpmVersion = if ($pnpmProgram) { & $pnpmProgram --version } else { '' }
    if (!$pnpmProgram -or $installedPnpmVersion -ne $requiredPnpmVersion) {
        $npmProgram = Find-Program -Names @('npm.cmd', 'npm.exe', 'npm')
        if (!$npmProgram) { throw 'npm was not found. Repair the Node.js installation.' }
        Write-Host "Installing the pnpm version required by Vencord ($requiredPnpmVersion)..."
        Invoke-Checked -Program $npmProgram -Arguments @('install', '-g', "pnpm@$requiredPnpmVersion")
        $pnpmProgram = Find-Program -Names @('pnpm.cmd', 'pnpm.exe', 'pnpm')
        if (!$pnpmProgram) { throw 'pnpm was installed but is not on PATH. Open a new PowerShell window and retry.' }
    }

    Set-Location -LiteralPath $VencordPath
    Write-Host 'Installing dependencies...'
    Invoke-Checked -Program $pnpmProgram -Arguments @('install', '--frozen-lockfile')
    Write-Host 'Building Vencord...'
    Invoke-Checked -Program $pnpmProgram -Arguments @('build')
    Write-Host 'Injecting Discord...'
    Invoke-Checked -Program $pnpmProgram -Arguments @('inject')

    Write-Host "`nINSTALL COMPLETE`nRestart Discord completely."
    Write-Host 'Enable Settings -> Vencord -> Plugins -> AutochannelKick.'
    if (!$NoPause) { [void](Read-Host 'Press Enter to continue') }
} finally {
    Set-Location -LiteralPath $originalLocation.Path
    if ($downloadDirectory) {
        # Delete only the unique download directory created by this run.
        $resolvedDownload = [IO.Path]::GetFullPath($downloadDirectory)
        $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
        if ($resolvedDownload.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and
            [IO.Path]::GetFileName($resolvedDownload) -match '^AutochannelKick-[a-f0-9]{32}$' -and
            (Test-Path -LiteralPath $resolvedDownload)) {
            Remove-Item -LiteralPath $resolvedDownload -Recurse -Force
        }
    }
}
