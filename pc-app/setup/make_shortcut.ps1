$desktop = [Environment]::GetFolderPath("Desktop")
$lnk = Join-Path $desktop "KZBS PhoneLink.lnk"
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($lnk)
$sc.TargetPath = "C:\Users\Acer\OneDrive\Masaüstü\PhoneLink\pc-app\KZBS-PhoneLink.exe"
$sc.WorkingDirectory = "C:\Users\Acer\OneDrive\Masaüstü\PhoneLink\pc-app"
$sc.Description = "KZBS PhoneLink v1.0.0"
$sc.Save()
Write-Host "Masaustu kisayolu basariyla kaydedildi: $lnk"
