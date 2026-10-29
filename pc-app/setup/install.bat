@echo off
title KZBS PhoneLink v1.0.0 Kurulum Sihirbazi
chcp 65001 >nul
cls
echo ================================================================
echo    🌟 KZBS PhoneLink v1.0.0 Windows Kurulum ve Entegrasyon
echo ================================================================
echo.
echo [1/3] Bagimliliklar kontrol ediliyor...
cd /d "%~dp0\.."

if not exist node_modules (
    echo [i] Ilk kurulum: Paketler yukleniyor...
    call npm install
) else (
    echo [OK] Paketler hazir!
)

echo.
echo [2/3] Masaustune KZBS PhoneLink Kisayolu Olusturuluyor...

set "TARGET_DIR=%~dp0\.."
set "START_SCRIPT=%TARGET_DIR%\start.bat"
set "DESKTOP_DIR=%USERPROFILE%\Desktop"
set "SHORTCUT_PATH=%DESKTOP_DIR%\KZBS PhoneLink.lnk"

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = '%START_SCRIPT%'; $s.WorkingDirectory = '%TARGET_DIR%'; $s.Description = 'KZBS PhoneLink v1.0.0 Telefon & PC Koprusu'; $s.Save()"

echo [OK] Masaustu kisayolu basariyla olusturuldu!
echo.
echo [3/3] Kurulum Tamamlandi!
echo.
echo ================================================================
echo    Tebrikler! KZBS PhoneLink v1.0.0 basariyla kuruldu.
echo    Masaustunuzdeki 'KZBS PhoneLink' simgesinden baslatabilirsiniz!
echo ================================================================
echo.
set /p START_NOW="Simdi baslatmak ister misiniz? (E/H): "
if /i "%START_NOW%"=="E" (
    start "" "%START_SCRIPT%"
)
