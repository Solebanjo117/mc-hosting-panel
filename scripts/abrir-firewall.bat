@echo off
chcp 65001 >nul
title Abrir puerto en el Firewall de Windows

:: Se vuelve a abrir como administrador si hace falta.
net session >nul 2>&1
if errorlevel 1 (
  echo  Pidiendo permisos de administrador...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo.
echo  Este script permite conexiones entrantes a un servidor de Minecraft.
echo  No abras el puerto del panel (8080).
echo.
echo    1. Java    (TCP, normalmente 25565)
echo    2. Bedrock (TCP y UDP, normalmente 19132, si activaste Geyser)
echo.
choice /c 12 /n /m "  Elige 1 o 2: "
if errorlevel 2 goto :bedrock
set PROTO=TCP
set DEFAULT=25565
set LABEL=Minecraft
goto :ask

:bedrock
set PROTO=UDP
set DEFAULT=19132
set LABEL=Minecraft Bedrock

:ask
echo.
set PORT=
set /p PORT=  Puerto a abrir [%DEFAULT%]:
if "%PORT%"=="" set PORT=%DEFAULT%

echo %PORT%| findstr /r "^[0-9][0-9]*$" >nul
if errorlevel 1 goto :invalid
if %PORT% LSS 1024 goto :invalid
if %PORT% GTR 65535 goto :invalid
if %PORT%==8080 (
  echo  El 8080 es el puerto del panel. No se recomienda abrirlo.
  pause
  exit /b 1
)

:: Borra una regla anterior con el mismo nombre para no duplicarla.
netsh advfirewall firewall delete rule name="%LABEL% %PORT%" >nul 2>&1
netsh advfirewall firewall add rule name="%LABEL% %PORT%" dir=in action=allow protocol=%PROTO% localport=%PORT% profile=any
if errorlevel 1 (
  echo  No se pudo crear la regla.
  pause
  exit /b 1
)

echo.
echo  Listo: el Firewall de Windows ya permite el puerto %PORT% %PROTO%.
echo  Ahora crea el reenvio de puertos %PROTO% en tu router (ver la guia del panel).
echo  Para quitar la regla: netsh advfirewall firewall delete rule name="%LABEL% %PORT%"
pause
exit /b 0

:invalid
echo  Puerto invalido: escribe un numero entre 1024 y 65535.
pause
exit /b 1
