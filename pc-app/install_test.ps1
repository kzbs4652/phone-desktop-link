$sourceDir = "pc-app\package_dist"
$targetDir = "$env:LOCALAPPDATA\KZBS PhoneLink"

if (Test-Path $targetDir) { Remove-Item -Recurse -Force $targetDir }
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
Copy-Item -Path "$sourceDir\*" -Destination $targetDir -Recurse -Force

# Create Desktop Shortcut (checking for OneDrive Desktop as well)
$desktopDir = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::DesktopDirectory)
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut("$desktopDir\KZBS PhoneLink.lnk")
$sc.TargetPath = "$targetDir\KZBS-PhoneLink.exe"
$sc.WorkingDirectory = $targetDir
$sc.Description = "KZBS PhoneLink v1.0.0"
$sc.Save()

Write-Host "Kurulum testi basarili! Hedef: $targetDir\KZBS-PhoneLink.exe" -ForegroundColor Green
