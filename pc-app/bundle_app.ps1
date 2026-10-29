$ErrorActionPreference = "Stop"

$distDir = "package_dist"
if (Test-Path $distDir) { Remove-Item -Recurse -Force $distDir }
New-Item -ItemType Directory -Force -Path $distDir | Out-Null

Write-Host "[1/5] Electron runtime kopyalaniyor..." -ForegroundColor Cyan
Copy-Item -Path "node_modules\electron\dist\*" -Destination $distDir -Recurse -Force

Write-Host "[2/5] Ana calistirici KZBS-PhoneLink.exe yapiliyor..." -ForegroundColor Cyan
if (Test-Path "$distDir\electron.exe") {
    Rename-Item -Path "$distDir\electron.exe" -NewName "KZBS-PhoneLink.exe" -Force
}

Write-Host "[3/5] resources\app hazirlaniyor..." -ForegroundColor Cyan
$appDir = "$distDir\resources\app"
New-Item -ItemType Directory -Force -Path $appDir | Out-Null

Copy-Item "package.json" $appDir -Force
Copy-Item "main.js" $appDir -Force
Copy-Item "server.js" $appDir -Force
Copy-Item -Recurse "public" $appDir -Force

Write-Host "[4/5] Calisma zamanı modulleri kopyalaniyor..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path "$appDir\node_modules" | Out-Null
Get-ChildItem -Path "node_modules" -Exclude "electron" | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination "$appDir\node_modules" -Recurse -Force
}

Write-Host "[5/5] default_app.asar temizleniyor..." -ForegroundColor Cyan
if (Test-Path "$distDir\resources\default_app.asar") {
    Remove-Item -Force "$distDir\resources\default_app.asar"
}

Write-Host "TAMAMLANDI! Standalone Masaustu Paketi Hazir: $distDir" -ForegroundColor Green
