# KZBS PhoneLink v1.0.7

Android telefon ile Windows bilgisayar arasında yerel Wi-Fi üzerinden bağlantı kurar. Telefon eşleştirme kodunu doğruladıktan sonra izin verilen SMS'leri, kişileri ve arama geçmişini bilgisayara aktarır. SMS'ler bilgisayarda kalıcı saklanır; eşitleme durumu ve izin hataları Mesajlar ekranında görünür. Bilgisayardan telefon hattıyla arama başlatabilir ve SMS gönderebilirsiniz.

## İlk bağlantı

1. Bilgisayara PhoneLink kurulumunu yapıp uygulamayı açın.
2. APK'yı Android telefona kurup PhoneLink'i açın; ilk kullanımda telefon ve SMS izinlerini verin.
3. Telefon ve bilgisayarı aynı Wi-Fi ağına bağlayın. Telefonda **QR Koduyla Eşleştir** seçeneğini kullanıp bilgisayardaki QR kodunu okutun. Kamera kullanılamazsa bilgisayardaki 6 haneli kodu girip **Bilgisayarları Bul** seçeneğini kullanın.
4. İlk eşleşme kaydedilir. Sonraki açılışlarda telefon aynı Wi-Fi ağına geldiğinde bilgisayara otomatik bağlanır; Android'de bağlantı bildiriminin açık kalması normaldir.

Windows güvenlik duvarı yerel ağ bağlantısını sorarsa PhoneLink'e **Özel ağlarda** izin verin.

Telefon bağlı değilken bilgisayar arayüzü örnek telefon bilgisi göstermez. Bilgisayardan başlatılan arama telefondaki SIM hattını kullanır. Bilgisayardan aramayı tuşlama, sessize alma, bekletme ve sonlandırma kontrolleri için Android uygulamasındaki **Bilgisayardan Arama Denetimini Aç** düğmesine basıp PhoneLink'i varsayılan telefon uygulaması olarak onaylayın. Görüşme sesini bilgisayara taşımak için telefon ile bilgisayarı Bluetooth üzerinden eşleştirip arama ekranında **PC sesi (BT)** seçin. Bunun çalışması telefonun bilgisayarı Bluetooth eller serbest arama aygıtı olarak görmesine ve Windows'un Bluetooth sürücüsünün bu rolü desteklemesine bağlıdır. Wi-Fi veya bulut bağlantısı tek başına hücresel arama sesini taşımaz.

Mesajlar ekranındaki **Yeniden eşitle** düğmesi telefondan SMS listesini tekrar çeker. SMS okuma izni verilmediyse uygulama önceki mesajları korur ve izin hatasını gösterir; başarılı eşitlemede güncel liste bilgisayara kaydedilir.

## Paket oluşturma

- Windows kurucusu: `pc-app/bundle_app.ps1` (`dist/KZBS-PhoneLink-Setup-v1.0.7.exe`)
- Android APK: `android-app/build_apk.ps1` (`dist/KZBS-PhoneLink-v1.0.7.apk`)

Android güncellemelerinin mevcut kurulumun üzerine yüklenebilmesi için `android-app/build_temp/debug.keystore` dosyasını koruyun.

## Güncelleme bildirimi

Windows ve Android aynı `version.json` sürüm numarasını kullanır. Yeni sürüm GitHub Release olarak yayımlandıktan ve güncel `version.json` `main` dalına gönderildikten sonra uygulamalar **Şimdi indir / Daha sonra** bildirimi gösterir. Windows'ta indirme bitince uygulama kapanıp kurulumu başlatır ve yeniden açılır. Android'de APK uygulama içinden indirilir ve sistem kurulum ekranı açılır; Android'in son yükleme onayı kullanıcı tarafından verilir.
