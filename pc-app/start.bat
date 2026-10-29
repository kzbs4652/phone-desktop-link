@echo off
title KZBS PhoneLink v1.0.0
chcp 65001 >nul
echo =======================================================
echo    🌟 KZBS PhoneLink v1.0.0 Baslatiliyor...
echo =======================================================
cd /d "%~dp0"

start "" http://localhost:4955
node server.js
pause
