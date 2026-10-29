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
    & $builder --win nsis --publish never "-c.directories.output=$stagingDir"
    if ($LASTEXITCODE -ne 0) {
        throw "Windows kurulum paketi oluşturulamadı (electron-builder exit code: $LASTEXITCODE)."
    }
} finally {
    Pop-Location
}

if (-not (Test-Path -LiteralPath $outputExe)) {
    throw "Kurulum dosyası bulunamadı: $outputExe"
}

$blockmapName = "$artifactName.blockmap"
$blockmapPath = Join-Path $stagingDir $blockmapName
if (-not (Test-Path -LiteralPath $blockmapPath)) {
    throw "Windows güncelleyicisinin ihtiyaç duyduğu dosya özeti bulunamadı: $blockmapPath"
}

$hashHex = (Get-FileHash -LiteralPath $outputExe -Algorithm SHA512).Hash
$hashBytes = for ($index = 0; $index -lt $hashHex.Length; $index += 2) {
    [Convert]::ToByte($hashHex.Substring($index, 2), 16)
}
$hashBase64 = [Convert]::ToBase64String([byte[]]$hashBytes)
$artifactSize = (Get-Item -LiteralPath $outputExe).Length
$releaseDate = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$updateManifest = @"
version: $($manifest.version)
files:
  - url: $artifactName
    sha512: $hashBase64
    size: $artifactSize
path: $artifactName
sha512: $hashBase64
releaseDate: '$releaseDate'
"@
$latestYamlPath = Join-Path $stagingDir "latest.yml"
[IO.File]::WriteAllText($latestYamlPath, $updateManifest, [Text.UTF8Encoding]::new($false))

New-Item -ItemType Directory -Force -Path $distDir | Out-Null
Copy-Item -LiteralPath $outputExe -Destination (Join-Path $distDir $artifactName) -Force
Copy-Item -LiteralPath $blockmapPath -Destination (Join-Path $distDir $blockmapName) -Force
Copy-Item -LiteralPath $latestYamlPath -Destination (Join-Path $distDir "latest.yml") -Force
Write-Host "Kurulum paketi hazır: $(Join-Path $distDir $artifactName)" -ForegroundColor Green
Write-Host "Güncelleme paket özeti hazır: $(Join-Path $distDir 'latest.yml')" -ForegroundColor Green
