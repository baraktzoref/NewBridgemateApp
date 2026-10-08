; Inno Setup script for the NewBridgemate Windows installer.
; Built in CI (see .github/workflows/build-windows-installer.yml):
;   ISCC.exe /DAppVersion=1.2.3 /DStageDir=<staged bundle> /DOutDir=<output dir> bridge.iss
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef StageDir
  #define StageDir "..\..\dist\stage"
#endif
#ifndef OutDir
  #define OutDir "..\..\dist"
#endif

[Setup]
AppId={{6F1E2B7A-4C3D-4E8B-9A55-2D7C1B0E9F31}
AppName=NewBridgemate
AppVersion={#AppVersion}
AppPublisher=NewBridgemate
DefaultDirName={autopf}\NewBridgemate
DefaultGroupName=NewBridgemate
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutDir}
OutputBaseFilename=NewBridgemate-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Dirs]
; The database lives outside Program Files so the server can write to it without admin rights.
Name: "{commonappdata}\NewBridgemate"; Permissions: users-modify

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\Start Bridge Server"; Filename: "{app}\start-server.bat"; WorkingDir: "{app}"
Name: "{group}\Create New Event"; Filename: "{app}\create-event.bat"; WorkingDir: "{app}"
Name: "{group}\Director Screen"; Filename: "{app}\open-director.bat"; WorkingDir: "{app}"
Name: "{group}\Windows Guide"; Filename: "{app}\README-WINDOWS.md"
Name: "{autodesktop}\Start Bridge Server"; Filename: "{app}\start-server.bat"; WorkingDir: "{app}"

[Run]
; Allow phones on the local network to reach the server (all network profiles; Windows often labels club WiFi "public").
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""NewBridgemate"" dir=in action=allow protocol=TCP localport=8080"; Flags: runhidden; StatusMsg: "Opening port 8080 in Windows Firewall..."

[UninstallRun]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""NewBridgemate"""; Flags: runhidden
