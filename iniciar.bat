@echo off
chcp 65001 >nul
title MC Hosting Panel
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  No se encontro Node.js. Instala la version LTS desde https://nodejs.org/es
  echo  y vuelve a abrir este archivo.
  start "" https://nodejs.org/es/download
  pause
  exit /b 1
)

node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"
if errorlevel 1 (
  echo.
  echo  Tu Node.js es muy viejo. Instala la version 20 o mas reciente desde https://nodejs.org/es
  pause
  exit /b 1
)

if not exist node_modules (
  echo  Instalando dependencias, solo la primera vez...
  call npm install
  if errorlevel 1 goto :error
)

if not exist dist\index.html (
  echo  Compilando la interfaz, solo la primera vez...
  call npm run build
  if errorlevel 1 goto :error
)

set OPEN_BROWSER=1
node server\index.js
echo.
echo  El panel se detuvo.
pause
exit /b 0

:error
echo.
echo  Algo fallo durante la preparacion. Revisa los mensajes de arriba.
pause
exit /b 1
