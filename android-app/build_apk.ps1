$ErrorActionPreference = "Stop"

$projectDir = $PSScriptRoot
$repoDir = Split-Path -Parent $projectDir
$manifest = Get-Content -LiteralPath (Join-Path $repoDir "version.json") -Raw | ConvertFrom-Json
$version = $manifest.version
if ($manifest.android.version -ne $version -or [int]$manifest.android.versionCode -ne [int]$manifest.versionCode) {
    throw "Android ve ortak sürüm numaraları eşleşmiyor. Önce version.json dosyasını düzeltin."
}
$apkName = "KZBS-PhoneLink-v$version.apk"
$builtApk = Join-Path $projectDir "app\build\outputs\apk\release\app-release.apk"
$distDir = Join-Path $repoDir "dist"
$outputApk = Join-Path $distDir $apkName

$javaHome = "C:\Program Files\Eclipse Adoptium\jdk-17.0.17.10-hotspot"
if (-not (Test-Path -LiteralPath (Join-Path $javaHome "bin\java.exe"))) {
    throw "Java 17 bulunamadı: $javaHome"
}
$env:JAVA_HOME = $javaHome
$env:PATH = "$javaHome\bin;$env:PATH"

$sdkCandidates = @("C:\Android\sdk", (Join-Path $env:LOCALAPPDATA "Android\Sdk"))
$androidSdk = $sdkCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $androidSdk) {
    throw "Android SDK bulunamadı. Android SDK'nın C:\Android\sdk veya %LOCALAPPDATA%\Android\Sdk konumunda olması gerekir."
}
$env:ANDROID_HOME = $androidSdk
$env:ANDROID_SDK_ROOT = $androidSdk

$keystore = Join-Path $projectDir "build_temp\debug.keystore"
if (-not (Test-Path -LiteralPath $keystore)) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $keystore) | Out-Null
    & (Join-Path $javaHome "bin\keytool.exe") -genkeypair -v `
        -keystore $keystore -storepass android -alias androiddebugkey -keypass android `
        -keyalg RSA -keysize 2048 -validity 10000 `
        -dname "CN=KZBS,O=KZBSPhoneLink,C=TR"
    if ($LASTEXITCODE -ne 0) {
        throw "Android APK imza anahtarı oluşturulamadı."
    }
}

Push-Location $projectDir
try {
    & ".\gradlew.bat" --no-daemon --console=plain :app:assembleRelease
    if ($LASTEXITCODE -ne 0) {
        throw "Android APK derlemesi başarısız oldu (Gradle exit code: $LASTEXITCODE)."
    }
} finally {
    Pop-Location
}

if (-not (Test-Path -LiteralPath $builtApk)) {
    throw "Gradle derlemesi tamamlandı ancak APK bulunamadı: $builtApk"
}

New-Item -ItemType Directory -Force -Path $distDir | Out-Null
Copy-Item -LiteralPath $builtApk -Destination $outputApk -Force
Write-Host "APK hazır: $outputApk" -ForegroundColor Green
Write-Host "APK imzalandı. Android güncellemeleri için android-app\build_temp\debug.keystore dosyasını koruyun."
