@echo off
title KZBS PhoneLink v1.0.5
chcp 65001 >nul
echo =======================================================
echo    🌟 KZBS PhoneLink v1.0.5 Baslatiliyor...
echo =======================================================
cd /d "%~dp0"
npm start
if errorlevel 1 pause
