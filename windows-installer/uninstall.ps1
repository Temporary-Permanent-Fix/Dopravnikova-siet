#requires -version 5.0
<#
  Uninstaller for "Dopravnikova siet" (SKLC3 live visualization).
  Removes the installed app folder plus its Desktop and Start Menu shortcuts.
#>

$ErrorActionPreference = 'Stop'
$AppName = 'Dopravnikova siet'
$InstallDir = Join-Path $env:LOCALAPPDATA 'DopravnikovaSiet'

$startMenuShortcut = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$AppName.lnk"
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk"

Remove-Item $startMenuShortcut -Force -ErrorAction SilentlyContinue
Remove-Item $desktopShortcut -Force -ErrorAction SilentlyContinue

if (Test-Path $InstallDir) {
    Remove-Item $InstallDir -Recurse -Force
    Write-Host "$AppName bola odinstalovana z $InstallDir."
} else {
    Write-Host "$AppName sa nenasla v $InstallDir (mozno uz bola odinstalovana)."
}
