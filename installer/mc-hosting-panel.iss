; Instalador de Windows de MC Hosting Panel (Inno Setup 6).
; Primero: npm run build && node scripts/build-installer.mjs
; Después:  ISCC /DAppVersion=0.11.0 installer\mc-hosting-panel.iss
; Trae su propio Node: no hace falta instalar nada más. Se instala para el usuario actual (sin pedir permisos
; de administrador) y la carpeta data (servidores, mundos, ajustes) nunca se borra al actualizar ni al desinstalar.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#define AppName "MC Hosting Panel"

[Setup]
AppId={{8F2C5B9E-6A1D-4C7B-9E2F-3D4A5B6C7D8E}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=Juan Antonio Castilla Orta
AppPublisherURL=https://github.com/Solebanjo117/mc-hosting-panel
AppSupportURL=https://github.com/Solebanjo117/mc-hosting-panel/issues
DefaultDirName={localappdata}\Programs\{#AppName}
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
OutputDir=..\build
OutputBaseFilename=MC-Hosting-Panel-Setup-{#AppVersion}
SetupIconFile=..\build\panel.ico
UninstallDisplayIcon={app}\panel.ico
UninstallDisplayName={#AppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon"; Description: "Crear un acceso directo en el escritorio"
Name: "startup"; Description: "Abrir el panel al iniciar sesión en Windows"; Flags: unchecked

[InstallDelete]
; Al actualizar se quitan los archivos de la versión anterior (data no se toca).
Type: filesandordirs; Name: "{app}\server"
Type: filesandordirs; Name: "{app}\dist"
Type: filesandordirs; Name: "{app}\node_modules"

[Files]
Source: "..\build\app\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Dirs]
Name: "{app}\data"; Flags: uninsneveruninstall

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\node\node.exe"; Parameters: "server\index.js --abrir"; WorkingDir: "{app}"; IconFilename: "{app}\panel.ico"; Comment: "Abre el panel de tus servidores de Minecraft"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\node\node.exe"; Parameters: "server\index.js --abrir"; WorkingDir: "{app}"; IconFilename: "{app}\panel.ico"; Tasks: desktopicon
; Mismo nombre que crea el panel desde Ajustes, así se reconocen.
Name: "{userstartup}\{#AppName}"; Filename: "{app}\node\node.exe"; Parameters: "server\index.js"; WorkingDir: "{app}"; IconFilename: "{app}\panel.ico"; Flags: runminimized; Tasks: startup

[Run]
Filename: "{app}\node\node.exe"; Parameters: "server\index.js --abrir"; WorkingDir: "{app}"; Description: "Abrir {#AppName}"; Flags: nowait postinstall skipifsilent
; Instalación silenciosa = actualización hecha desde el panel: se vuelve a abrir solo (la pestaña ya abierta se recarga).
Filename: "{app}\node\node.exe"; Parameters: "server\index.js"; WorkingDir: "{app}"; Flags: nowait runminimized; Check: WizardSilent

[UninstallDelete]
Type: files; Name: "{userstartup}\{#AppName}.lnk"
Type: filesandordirs; Name: "{app}\node_modules"
