$ErrorActionPreference = "Stop"

$JAVA_DIR = "C:\Program Files\Eclipse Adoptium\jdk-17.0.17.10-hotspot"
$env:JAVA_HOME = $JAVA_DIR
$env:PATH = "$JAVA_DIR\bin;$env:PATH"

$BUILD_TOOLS = "C:\Android\sdk\build-tools\34.0.0"
$PLATFORM = "C:\Android\sdk\platforms\android-34\android.jar"
$AAPT2 = "$BUILD_TOOLS\aapt2.exe"
$ZIPALIGN = "$BUILD_TOOLS\zipalign.exe"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  KZBS PhoneLink APK Derleme Basliyor...  " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1. Prepare temp dirs
$WORK = "android-app\build_temp"
if (Test-Path $WORK) { Remove-Item -Recurse -Force $WORK }
New-Item -ItemType Directory -Force -Path "$WORK\compiled_res" | Out-Null
New-Item -ItemType Directory -Force -Path "$WORK\gen" | Out-Null
New-Item -ItemType Directory -Force -Path "$WORK\bin" | Out-Null
New-Item -ItemType Directory -Force -Path "$WORK\dex" | Out-Null

# 2. Compile Resources with AAPT2
Write-Host "[1/6] Kaynaklar derleniyor (AAPT2)..."
& $AAPT2 compile --dir android-app\app\src\main\res -o "$WORK\compiled_res.zip"

# 3. Link Resources
Write-Host "[2/6] Kaynaklar ve Manifest baglaniyor (AAPT2 Link)..."
& $AAPT2 link -o "$WORK\base.apk" -I $PLATFORM --manifest android-app\app\src\main\AndroidManifest.xml --java "$WORK\gen" "$WORK\compiled_res.zip" --auto-add-overlay

# 4. Compile Java Sources
Write-Host "[3/6] Java kodlari derleniyor (Javac)..."
$javaFiles = (Get-ChildItem -Path "android-app\src_java", "$WORK\gen" -Filter "*.java" -Recurse).FullName
& "$JAVA_DIR\bin\javac.exe" -source 8 -target 8 -cp "$PLATFORM;$WORK\gen" -d "$WORK\bin" $javaFiles

# 5. Convert to DEX (D8 directly via Java to handle spaces)
Write-Host "[4/6] DEX bayt kodlari uretiliyor (D8)..."
$classFiles = (Get-ChildItem -Path "$WORK\bin" -Filter "*.class" -Recurse).FullName
& "$JAVA_DIR\bin\java.exe" -cp "$BUILD_TOOLS\lib\d8.jar" com.android.tools.r8.D8 --output "$WORK\dex" $classFiles

# 6. Add classes.dex to APK
Write-Host "[5/6] classes.dex APK paketine ekleniyor..."
Copy-Item "$WORK\base.apk" "$WORK\unsigned.apk"
& "$JAVA_DIR\bin\jar.exe" uf "$WORK\unsigned.apk" -C "$WORK\dex" classes.dex

# 7. ZipAlign and Sign
Write-Host "[6/6] APK hizalaniyor ve imzalanıyor (ZipAlign & Apksigner)..."
$finalApk = "dist\KZBS-PhoneLink-v1.0.0.apk"
$alignedApk = "$WORK\aligned.apk"
& $ZIPALIGN -v -p -f 4 "$WORK\unsigned.apk" $alignedApk

# Keystore check
$keystore = "$WORK\debug.keystore"
& "$JAVA_DIR\bin\keytool.exe" -genkeypair -v -keystore $keystore -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=KZBS,O=KZBSPhoneLink,C=TR"

& "$JAVA_DIR\bin\java.exe" -jar "$BUILD_TOOLS\lib\apksigner.jar" sign --ks "$keystore" --ks-pass pass:android --ks-key-alias androiddebugkey --key-pass pass:android --out "$finalApk" "$alignedApk"

Write-Host "==========================================" -ForegroundColor Green
Write-Host "  TEBRIKLER! APK BASARIYLA DERLENDI!      " -ForegroundColor Green
Write-Host "  Konum: $finalApk                        " -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
