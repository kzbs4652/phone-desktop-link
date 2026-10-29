$ErrorActionPreference = "Stop"
$appDir = $PSScriptRoot
$repoDir = Split-Path -Parent $appDir
$manifest = Get-Content -LiteralPath (Join-Path $repoDir "version.json") -Raw | ConvertFrom-Json
if ($manifest.pc.version -ne $manifest.version -or $manifest.android.version -ne $manifest.version -or (Get-Content -LiteralPath (Join-Path $appDir "package.json") -Raw | ConvertFrom-Json).version -ne $manifest.version) {
    throw "Windows, Android ve ortak sürüm numaraları eşleşmiyor. Önce version.json ve pc-app/package.json dosyalarını eşitleyin."
}
$artifactName = "KZBS-PhoneLink-Setup-v$($manifest.pc.version).exe"
$stagingDir = Join-Path $env:LOCALAPPDATA "KZBS PhoneLink\build"
$outputExe = Join-Path $stagingDir $artifactName
$distDir = Join-Path $repoDir "dist"
$builder = Join-Path $appDir "node_modules\.bin\electron-builder.cmd"

New-Item -ItemType Directory -Force -Path $stagingDir | Out-Null
Push-Location $appDir
try {
    & $builder --win nsis "-c.directories.output=$stagingDir"
    if ($LASTEXITCODE -ne 0) {
        throw "Windows kurulum paketi oluşturulamadı (electron-builder exit code: $LASTEXITCODE)."
    }
} finally {
    Pop-Location
}

if (-not (Test-Path -LiteralPath $outputExe)) {
    throw "Kurulum dosyası bulunamadı: $outputExe"
}

New-Item -ItemType Directory -Force -Path $distDir | Out-Null
Copy-Item -LiteralPath $outputExe -Destination (Join-Path $distDir $artifactName) -Force
Write-Host "Kurulum paketi hazır: $(Join-Path $distDir $artifactName)" -ForegroundColor Green
