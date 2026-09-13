; NSIS Installer Script for Orbis + ORION
; Phase 18: Windows Packaging

!include "MUI2.nsh"
!include "x64.nsh"

; Installer Details
Name "Orbis"
OutFile "dist\Orbis-Installer-1.0.0.exe"
InstallDir "$PROGRAMFILES64\Orbis"

; MUI Settings
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_LANGUAGE "English"

; Installer Sections
Section "Install"
  ; Create installation directory
  SetOutPath "$INSTDIR"

  ; Copy Orbis application files
  File /r "dist\Orbis-app\*.*"

  ; Copy ORION runtime bundle
  SetOutPath "$INSTDIR\orion-runtime"
  File /r "orion-runtime\*.*"

  ; Create shortcuts
  CreateDirectory "$SMPROGRAMS\Orbis"
  CreateShortcut "$SMPROGRAMS\Orbis\Orbis.lnk" "$INSTDIR\Orbis.exe"
  CreateShortcut "$DESKTOP\Orbis.lnk" "$INSTDIR\Orbis.exe"

  ; Write uninstaller
  WriteUninstaller "$INSTDIR\uninstall.exe"
  CreateShortcut "$SMPROGRAMS\Orbis\Uninstall.lnk" "$INSTDIR\uninstall.exe"

  ; Register app in Add/Remove Programs
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Orbis" \
    "DisplayName" "Orbis"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Orbis" \
    "UninstallString" "$INSTDIR\uninstall.exe"
SectionEnd

; Uninstaller
Section "Uninstall"
  ; Remove application files
  RMDir /r "$INSTDIR"

  ; Remove shortcuts
  Delete "$SMPROGRAMS\Orbis\Orbis.lnk"
  Delete "$SMPROGRAMS\Orbis\Uninstall.lnk"
  RMDir "$SMPROGRAMS\Orbis"
  Delete "$DESKTOP\Orbis.lnk"

  ; Remove registry entries
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Orbis"
SectionEnd
