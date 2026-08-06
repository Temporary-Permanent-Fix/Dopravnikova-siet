; NSIS installer for "Dopravnikova siet" (SKLC3 live visualization).
; Per-user install (no admin rights required) - bundles the static frontend
; (src/) and the dependency-free Node.js server (server/) plus data/.
;
; Build:  makensis DopravnikovaSiet.nsi
; Output: dist\DopravnikovaSietSetup.exe

!include "MUI2.nsh"
!include "LogicLib.nsh"

Name "Dopravnikova siet"
OutFile "dist\DopravnikovaSietSetup.exe"
InstallDir "$LOCALAPPDATA\DopravnikovaSiet"
RequestExecutionLevel user
SetCompressor /SOLID lzma

!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\start-app.bat"
!define MUI_FINISHPAGE_RUN_TEXT "Spustit Dopravnikovu siet"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Section "Dopravnikova siet" SecMain
  SetOutPath "$INSTDIR\src"
  File /r "..\src\*.*"

  SetOutPath "$INSTDIR\server"
  File /r /x ".env" "..\server\*.*"

  SetOutPath "$INSTDIR\data"
  File /r "..\data\*.*"

  SetOutPath "$INSTDIR"
  File "..\package.json"

  FileOpen $0 "$INSTDIR\start-app.bat" w
  FileWrite $0 "@echo off$\r$\n"
  FileWrite $0 "cd /d %~dp0$\r$\n"
  FileWrite $0 'start "" http://127.0.0.1:5173/$\r$\n'
  FileWrite $0 "node server\index.mjs$\r$\n"
  FileClose $0

  nsExec::ExecToStack 'cmd /c node --version'
  Pop $0
  ${If} $0 != "0"
    MessageBox MB_YESNO|MB_ICONQUESTION "Node.js sa na tomto pocitaci nenasiel. Appka ho potrebuje na spustenie.$\r$\n$\r$\nOtvorit stranku nodejs.org na stiahnutie?" IDYES OpenNodeSite
    Goto SkipNodeSite
    OpenNodeSite:
      ExecShell "open" "https://nodejs.org/"
    SkipNodeSite:
  ${EndIf}

  CreateDirectory "$SMPROGRAMS\Dopravnikova siet"
  CreateShortcut "$SMPROGRAMS\Dopravnikova siet\Dopravnikova siet.lnk" "$INSTDIR\start-app.bat"
  CreateShortcut "$DESKTOP\Dopravnikova siet.lnk" "$INSTDIR\start-app.bat"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\Dopravnikova siet\Odinstalovat.lnk" "$INSTDIR\Uninstall.exe"

  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DopravnikovaSiet" "DisplayName" "Dopravnikova siet"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DopravnikovaSiet" "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DopravnikovaSiet" "InstallLocation" "$\"$INSTDIR$\""
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DopravnikovaSiet" "Publisher" "SKLC3"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DopravnikovaSiet" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DopravnikovaSiet" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir /r "$INSTDIR"
  Delete "$SMPROGRAMS\Dopravnikova siet\*.lnk"
  RMDir "$SMPROGRAMS\Dopravnikova siet"
  Delete "$DESKTOP\Dopravnikova siet.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DopravnikovaSiet"
SectionEnd
