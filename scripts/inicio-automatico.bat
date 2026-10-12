@echo off
chcp 65001 >nul
title Inicio automatico de MC Hosting Panel
cd /d "%~dp0.."

set "SHORTCUT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\MC Hosting Panel.lnk"

if exist "%SHORTCUT%" (
  choice /m "  El panel ya arranca con Windows. Quitar el inicio automatico"
  if errorlevel 2 exit /b 0
  del "%SHORTCUT%"
  echo  Listo: el panel ya no se abrira al iniciar Windows.
  pause
  exit /b 0
)

powershell -NoProfile -Command ^
  "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('%SHORTCUT%');" ^
  "$s.TargetPath = '%CD%\iniciar.bat';" ^
  "$s.WorkingDirectory = '%CD%';" ^
  "$s.WindowStyle = 7;" ^
  "$s.Save()"

if errorlevel 1 (
  echo  No se pudo crear el acceso directo.
  pause
  exit /b 1
)
echo  Listo: el panel se abrira minimizado cada vez que inicies sesion en Windows.
echo  Marca "Encender automaticamente" en los ajustes de cada servidor que quieras encendido.
pause
