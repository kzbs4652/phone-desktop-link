@echo off
title KZBS PhoneLink v1.0.7
chcp 65001 >nul
echo =======================================================
echo    🌟 KZBS PhoneLink v1.0.7 Baslatiliyor...
echo =======================================================
cd /d "%~dp0"
npm start
if errorlevel 1 pause
