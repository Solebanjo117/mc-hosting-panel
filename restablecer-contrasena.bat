@echo off
chcp 65001 >nul
title Restablecer contrasena de MC Hosting Panel
cd /d "%~dp0"
rem Si olvidaste la contrasena del panel. Solo funciona en esta PC.
if exist node\node.exe (set "NODE=node\node.exe") else (set "NODE=node")
"%NODE%" scripts\restablecer-contrasena.mjs
echo.
pause
