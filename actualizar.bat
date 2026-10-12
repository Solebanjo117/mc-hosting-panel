@echo off
chcp 65001 >nul
title Actualizar MC Hosting Panel
cd /d "%~dp0"

echo  Cierra la ventana del panel antes de continuar (tus servidores y mundos no se tocan).
pause

where git >nul 2>nul
if errorlevel 1 (
  echo  No se encontro Git. Descarga la version nueva desde GitHub y reemplaza los archivos,
  echo  conservando la carpeta "data".
  pause
  exit /b 1
)

git pull
if errorlevel 1 goto :error
call npm install
if errorlevel 1 goto :error
call npm run build
if errorlevel 1 goto :error

echo.
echo  Listo. Abre iniciar.bat para usar la version nueva.
pause
exit /b 0

:error
echo.
echo  La actualizacion fallo. Revisa los mensajes de arriba.
pause
exit /b 1
