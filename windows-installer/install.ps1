#requires -version 5.0
<#
  Installer for "Dopravnikova siet" (SKLC3 live visualization).
  Copies the app to %LOCALAPPDATA%\DopravnikovaSiet, installs Node.js if
  missing, and creates Desktop + Start Menu shortcuts that launch the app.
#>

$ErrorActionPreference = 'Stop'
$AppName = 'Dopravnikova siet'
$InstallDir = Join-Path $env:LOCALAPPDATA 'DopravnikovaSiet'
$RepoRoot = Split-Path -Parent $PSScriptRoot

function Test-NodeInstalled {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    return [bool]$cmd
}

function Install-NodeJs {
    Write-Host 'Node.js sa nenasiel. Skusam nainstalovat...'
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        try {
            winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
            return
        } catch {
            Write-Warning 'winget install zlyhal, skusam priame stiahnutie z nodejs.org.'
        }
    }
    Write-Host 'Stahujem Node.js LTS instalator z nodejs.org...'
    $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json'
    $lts = $index | Where-Object { $_.lts -ne $false } | Select-Object -First 1
    if (-not $lts) { throw 'Nepodarilo sa najst Node.js LTS verziu na stiahnutie.' }
    $version = $lts.version
    $arch = if ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
    $nodeUrl = "https://nodejs.org/dist/$version/node-$version-$arch.msi"
    $nodeMsi = Join-Path $env:TEMP 'node-installer.msi'
    Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeMsi
    Write-Host "Instalujem Node.js $version (moze sa zobrazit UAC prompt)..."
    Start-Process msiexec.exe -ArgumentList "/i `"$nodeMsi`" /qb" -Wait
    Remove-Item $nodeMsi -Force -ErrorAction SilentlyContinue
    $machinePath = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [System.Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machinePath;$userPath"
}

Write-Host "Instalujem $AppName do $InstallDir ..."

if (-not (Test-NodeInstalled)) {
    Install-NodeJs
    if (-not (Test-NodeInstalled)) {
        Write-Warning 'Node.js sa nenasiel ani po instalacii v tomto okne. Zavri a znovu otvor PowerShell/terminal a spusti install.ps1 znova.'
    }
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

foreach ($folder in @('src', 'server', 'data')) {
    $source = Join-Path $RepoRoot $folder
    $destination = Join-Path $InstallDir $folder
    if (-not (Test-Path $source)) { continue }
    if (Test-Path $destination) { Remove-Item $destination -Recurse -Force }
    Copy-Item $source $destination -Recurse -Force
}
Copy-Item (Join-Path $RepoRoot 'package.json') (Join-Path $InstallDir 'package.json') -Force

# server/.env drzi lokalne nastavenia (napr. Elasticsearch pripojenie) - pri
# reinstalacii ho nemazeme, len ponechame existujuci alebo pridame priklad.
$envExample = Join-Path $InstallDir 'server\.env.example'
$envFile = Join-Path $InstallDir 'server\.env'
if ((Test-Path $envExample) -and -not (Test-Path $envFile)) {
    Write-Host 'server/.env sa nenasiel - appka pobezi v mock rezime (bez Elasticsearch/Kibana).'
    Write-Host "Pre zive data uprav $envFile podla server/.env.example."
}

$launcherPath = Join-Path $InstallDir 'start-app.bat'
$launcherContent = @"
@echo off
cd /d "%~dp0"
start "" http://127.0.0.1:5173/
node server\index.mjs
"@
Set-Content -Path $launcherPath -Value $launcherContent -Encoding ASCII

Copy-Item (Join-Path $PSScriptRoot 'uninstall.ps1') (Join-Path $InstallDir 'uninstall.ps1') -Force

$WshShell = New-Object -ComObject WScript.Shell

$startMenuDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$startMenuShortcut = $WshShell.CreateShortcut((Join-Path $startMenuDir "$AppName.lnk"))
$startMenuShortcut.TargetPath = $launcherPath
$startMenuShortcut.WorkingDirectory = $InstallDir
$startMenuShortcut.Description = $AppName
$startMenuShortcut.Save()

$desktopDir = [Environment]::GetFolderPath('Desktop')
$desktopShortcut = $WshShell.CreateShortcut((Join-Path $desktopDir "$AppName.lnk"))
$desktopShortcut.TargetPath = $launcherPath
$desktopShortcut.WorkingDirectory = $InstallDir
$desktopShortcut.Description = $AppName
$desktopShortcut.Save()

Write-Host ''
Write-Host "Hotovo. $AppName je nainstalovana v $InstallDir"
Write-Host 'Odkaz na spustenie najdes na ploche a v Start menu.'
Write-Host ''

$answer = Read-Host 'Spustit aplikaciu teraz? (a/n)'
if ($answer -match '^[aAyY]') {
    Start-Process $launcherPath -WorkingDirectory $InstallDir
}
