# KZBS PhoneLink v1.0.5

Android telefon ile Windows bilgisayar arasında yerel Wi-Fi üzerinden bağlantı kurar. Telefon eşleştirme kodunu doğruladıktan sonra izin verilen SMS'leri, kişileri ve arama geçmişini bilgisayara aktarır. Bilgisayardan telefon hattıyla arama başlatabilir ve SMS gönderebilirsiniz.

## İlk bağlantı

1. Bilgisayara PhoneLink kurulumunu yapıp uygulamayı açın.
2. APK'yı Android telefona kurup PhoneLink'i açın; ilk kullanımda telefon ve SMS izinlerini verin.
3. Telefon ve bilgisayarı aynı Wi-Fi ağına bağlayın. Telefonda **QR Koduyla Eşleştir** seçeneğini kullanıp bilgisayardaki QR kodunu okutun. Kamera kullanılamazsa bilgisayardaki 6 haneli kodu girip **Bilgisayarları Bul** seçeneğini kullanın.
4. İlk eşleşme kaydedilir. Sonraki açılışlarda telefon aynı Wi-Fi ağına geldiğinde bilgisayara otomatik bağlanır; Android'de bağlantı bildiriminin açık kalması normaldir.

Windows güvenlik duvarı yerel ağ bağlantısını sorarsa PhoneLink'e **Özel ağlarda** izin verin.

Telefon bağlı değilken bilgisayar arayüzü örnek telefon bilgisi göstermez. Bilgisayardan başlatılan arama telefondaki SIM hattını kullanır. Bilgisayardan aramayı tuşlama, sessize alma, bekletme ve sonlandırma kontrolleri için Android uygulamasındaki **Bilgisayardan Arama Denetimini Aç** düğmesine basıp PhoneLink'i varsayılan telefon uygulaması olarak onaylayın. Görüşme sesini bilgisayara taşımak için arama ekranında **PC sesi (BT)** seçin; bunun görünmesi telefonun bilgisayarı Bluetooth arama ses aygıtı olarak tanımasına ve Windows'un eller serbest arama bağlantısını desteklemesine bağlıdır. Wi-Fi bağlantısı tek başına hücresel arama sesini taşımaz.

## Paket oluşturma

- Windows kurucusu: `pc-app/bundle_app.ps1` (`dist/KZBS-PhoneLink-Setup-v1.0.5.exe`)
- Android APK: `android-app/build_apk.ps1` (`dist/KZBS-PhoneLink-v1.0.5.apk`)

Android güncellemelerinin mevcut kurulumun üzerine yüklenebilmesi için `android-app/build_temp/debug.keystore` dosyasını koruyun.

## Güncelleme bildirimi

Windows ve Android aynı `version.json` sürüm numarasını kullanır. Yeni sürüm GitHub Release olarak yayımlandıktan ve güncel `version.json` `main` dalına gönderildikten sonra uygulamalar **Şimdi indir / Daha sonra** bildirimi gösterir. İndirme uygulama içinden yapılır; Windows kurulumunu veya Android APK kurulumunu kullanıcı başlatır.
