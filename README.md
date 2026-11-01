# KZBS PhoneLink v1.0.10

Android telefon ile Windows bilgisayar arasında yerel Wi-Fi üzerinden bağlantı kurar. PhoneLink arama özellikleri olmadan SMS eşitlemeye odaklanır. Bilgisayardaki Mesajlar ekranında `+` düğmesiyle yeni sohbet açabilir, telefon rehberinden A–Z sıralı kişi seçebilir veya numara girebilirsiniz. Bağlı telefonun pil seviyesi düzenli aralıklarla güncellenir.

Windows uygulaması pencereyi tam ekran büyüttüğünüzde kullanılabilir alanı doldurur; mesaj panelleri pencere yüksekliğine göre boyutlanır. Windows uygulama, kurulum ve kaldırma simgeleri mobil uygulamadaki PhoneLink logosunu kullanır.

## İlk bağlantı

1. Bilgisayara PhoneLink kurulumunu yapıp uygulamayı açın.
2. APK'yı Android telefona kurup PhoneLink'i açın; SMS ve rehber izinlerini verin. Rehber izni yeni mesaj ekranında kişi seçmek için kullanılır.
3. Telefon ve bilgisayarı aynı Wi-Fi ağına bağlayın. Telefonda **QR Koduyla Eşleştir** seçeneğini kullanıp bilgisayardaki QR kodunu okutun. Kamera kullanılamazsa bilgisayardaki 6 haneli kodu girip **Bilgisayarları Bul** seçeneğini kullanın.
4. İlk eşleşme kaydedilir. Sonraki açılışlarda telefon aynı Wi-Fi ağına geldiğinde bilgisayara otomatik bağlanır; Android'de bağlantı bildiriminin açık kalması normaldir.

Windows güvenlik duvarı yerel ağ bağlantısını sorarsa PhoneLink'e **Özel ağlarda** izin verin.

Mesajlar ekranındaki **Yeniden eşitle** düğmesi telefondan SMS listesini tekrar çeker. SMS okuma izni verilmediyse uygulama önceki mesajları korur ve izin hatasını gösterir; başarılı eşitlemede güncel liste bilgisayara kaydedilir.

Telefon rehberi bilgisayara kalıcı kaydedilmez; bağlıyken yeni mesaj alıcısı seçimi için aktarılır. Rehber izni verilmezse yeni sohbet ekranında numara elle girilebilir.

## Paket oluşturma

- Windows kurucusu: `pc-app/bundle_app.ps1` (`dist/KZBS-PhoneLink-Setup-v1.0.10.exe`)
- Android APK: `android-app/build_apk.ps1` (`dist/KZBS-PhoneLink-v1.0.10.apk`)

Android güncellemelerinin mevcut kurulumun üzerine yüklenebilmesi için `android-app/build_temp/debug.keystore` dosyasını koruyun.

## Güncelleme bildirimi

Windows ve Android aynı `version.json` sürüm numarasını kullanır. Yeni sürüm GitHub Release olarak yayımlandıktan ve güncel `version.json` `main` dalına gönderildikten sonra uygulamalar yeni sürüm bildirimi ve indirme ilerlemesi gösterir. Windows'ta indirme bitince uygulama kapanıp kurulumu başlatır ve yeniden açılır. Android'de APK uygulama içinden indirilir ve sistem kurulum ekranı açılır; Android'in son yükleme onayı kullanıcı tarafından verilir.
