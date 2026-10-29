package com.kzbs.phonelink

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.app.DownloadManager
import android.app.role.RoleManager
import android.net.Uri
import android.os.Environment
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.zxing.integration.android.IntentIntegrator
import com.kzbs.phonelink.service.PhoneLinkService
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {

    companion object {
        private const val PERMISSION_REQUEST_CODE = 1001
        private const val DIALER_ROLE_REQUEST_CODE = 1002
        private const val UPDATE_MANIFEST_URL = "https://raw.githubusercontent.com/kzbs4652/phone-desktop-link/main/version.json"
    }

    private val requiredPermissions = mutableListOf(
        Manifest.permission.RECEIVE_SMS,
        Manifest.permission.READ_SMS,
        Manifest.permission.SEND_SMS,
        Manifest.permission.CALL_PHONE,
        Manifest.permission.ANSWER_PHONE_CALLS,
        Manifest.permission.READ_PHONE_STATE,
        Manifest.permission.READ_CALL_LOG,
        Manifest.permission.READ_CONTACTS
    )

    private lateinit var status: TextView
    private lateinit var log: TextView
    private lateinit var hostInput: EditText
    private lateinit var codeInput: EditText
    private lateinit var discoveredList: LinearLayout
    private lateinit var updateBanner: LinearLayout
    private lateinit var updateText: TextView
    private var receiverRegistered = false
    private var pendingConnection: Pair<String, String>? = null
    private var currentUpdateVersion: String? = null
    private var currentUpdateNotes: String = ""
    private var updatePromptShownFor: String? = null
    private val discoveredHosts = mutableSetOf<String>()
    private val updateHandler = Handler(Looper.getMainLooper())
    private val periodicUpdateCheck = object : Runnable {
        override fun run() {
            checkForUpdate(manual = false)
            updateHandler.postDelayed(this, 60 * 60 * 1000L)
        }
    }

    private val serviceReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                PhoneLinkService.ACTION_PC_DISCOVERED -> {
                    val host = intent.getStringExtra(PhoneLinkService.EXTRA_HOST).orEmpty()
                    val port = intent.getIntExtra(PhoneLinkService.EXTRA_PORT, 4955)
                    val name = intent.getStringExtra(PhoneLinkService.EXTRA_NAME).orEmpty()
                    if (host.isNotBlank() && discoveredHosts.add(host)) addDiscoveredComputer(name, host, port)
                }
                PhoneLinkService.ACTION_CONNECTION_STATUS -> {
                    val message = intent.getStringExtra("message") ?: "Bağlantı durumu güncellendi"
                    val connected = intent.getBooleanExtra("connected", false)
                    status.text = message
                    status.setTextColor(getColor(if (connected) android.R.color.holo_green_light else android.R.color.holo_orange_light))
                    appendLog(message)
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        status = findViewById(R.id.tvConnectionStatus)
        log = findViewById(R.id.tvLogStream)
        hostInput = findViewById(R.id.editPcAddress)
        codeInput = findViewById(R.id.editPairingCode)
        discoveredList = findViewById(R.id.layoutDiscoveredComputers)
        updateBanner = findViewById(R.id.layoutUpdateBanner)
        updateText = findViewById(R.id.tvUpdateBannerText)
        findViewById<TextView>(R.id.tvAppVersion).text = " v${BuildConfig.VERSION_NAME}"

        findViewById<Button>(R.id.btnDiscoverComputers).setOnClickListener {
            discoveredHosts.clear()
            discoveredList.removeAllViews()
            appendLog("Aynı Wi-Fi ağındaki bilgisayarlar aranıyor…")
            startPhoneService(Intent(this, PhoneLinkService::class.java).setAction(PhoneLinkService.ACTION_DISCOVER))
        }

        findViewById<Button>(R.id.btnScanQr).setOnClickListener {
            IntentIntegrator(this)
                .setDesiredBarcodeFormats(IntentIntegrator.QR_CODE)
                .setPrompt("Bilgisayar ekranındaki PhoneLink QR kodunu tara")
                .setBeepEnabled(false)
                .setOrientationLocked(false)
                .initiateScan()
        }

        findViewById<Button>(R.id.btnConnectPc).setOnClickListener {
            val host = hostInput.text.toString().trim()
            val code = codeInput.text.toString().trim()
            if (host.isBlank() || !host.matches(Regex("^[a-zA-Z0-9.-]+$"))) {
                hostInput.error = "Bilgisayarın yerel IP adresini gir"
                return@setOnClickListener
            }
            if (!code.matches(Regex("^\\d{6}$"))) {
                codeInput.error = "Bilgisayardaki 6 haneli kodu gir"
                return@setOnClickListener
            }
            val missing = missingPermissions()
            if (missing.isNotEmpty()) {
                pendingConnection = host to code
                ActivityCompat.requestPermissions(this, missing.toTypedArray(), PERMISSION_REQUEST_CODE)
            } else {
                connect(host, code)
            }
        }

        findViewById<Button>(R.id.btnDisconnect).setOnClickListener {
            startPhoneService(Intent(this, PhoneLinkService::class.java).setAction(PhoneLinkService.ACTION_DISCONNECT))
            status.text = "Bilgisayara bağlı değil"
            appendLog("Eşleştirme kaldırıldı ve otomatik bağlantı kapatıldı.")
        }

        findViewById<Button>(R.id.btnPermissions).setOnClickListener {
            val missing = missingPermissions()
            if (missing.isEmpty()) {
                Toast.makeText(this, "Telefon özellikleri için gerekli izinler verilmiş.", Toast.LENGTH_SHORT).show()
            } else {
                pendingConnection = null
                ActivityCompat.requestPermissions(this, missing.toTypedArray(), PERMISSION_REQUEST_CODE)
            }
        }

        findViewById<Button>(R.id.btnEnableCallControls).setOnClickListener { requestDialerRole() }

        findViewById<Button>(R.id.btnBatteryOptimization).setOnClickListener { requestBatteryOptimizationExemption() }
        findViewById<Button>(R.id.btnCheckUpdates).setOnClickListener { checkForUpdate(manual = true) }
        findViewById<Button>(R.id.btnDownloadUpdate).setOnClickListener { showUpdatePrompt(force = true) }
        findViewById<Button>(R.id.btnLaterUpdate).setOnClickListener {
            currentUpdateVersion?.let { getSharedPreferences("updates", MODE_PRIVATE).edit().putString("deferredAndroidVersion", it).apply() }
            updateBanner.visibility = View.GONE
        }

        status.text = "Bilgisayara bağlı değil"
        updateDialerRoleStatus()
        appendLog("Hazır. Önce bilgisayardaki PhoneLink uygulamasını aç.")
        val setupPrefs = getSharedPreferences("setup", MODE_PRIVATE)
        if (missingPermissions().isNotEmpty() && !setupPrefs.getBoolean("permissionsPrompted", false)) {
            setupPrefs.edit().putBoolean("permissionsPrompted", true).apply()
            appendLog("İlk kullanım için arama ve SMS izinleri istenecek.")
            ActivityCompat.requestPermissions(this, missingPermissions().toTypedArray(), PERMISSION_REQUEST_CODE)
        }
        val pairingPrefs = getSharedPreferences(PhoneLinkService.PAIRING_PREFS, MODE_PRIVATE)
        if (!pairingPrefs.getString(PhoneLinkService.PREF_TOKEN, null).isNullOrBlank()) {
            appendLog("Kaydedilmiş bilgisayar aranıyor; tekrar eşleştirme gerekmiyor.")
            startPhoneService(Intent(this, PhoneLinkService::class.java).setAction(PhoneLinkService.ACTION_AUTO_CONNECT))
        }
        checkForUpdate(manual = false)
    }

    override fun onStart() {
        super.onStart()
        if (!receiverRegistered) {
            val filter = IntentFilter().apply {
                addAction(PhoneLinkService.ACTION_PC_DISCOVERED)
                addAction(PhoneLinkService.ACTION_CONNECTION_STATUS)
            }
            ContextCompat.registerReceiver(this, serviceReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
            receiverRegistered = true
        }
        PhoneLinkService.instance?.announceCurrentStatus()
        updateHandler.removeCallbacks(periodicUpdateCheck)
        updateHandler.postDelayed(periodicUpdateCheck, 60 * 60 * 1000L)
    }

    override fun onStop() {
        updateHandler.removeCallbacks(periodicUpdateCheck)
        if (receiverRegistered) {
            unregisterReceiver(serviceReceiver)
            receiverRegistered = false
        }
        super.onStop()
    }

    private fun addDiscoveredComputer(name: String, host: String, port: Int) {
        runOnUiThread {
            val button = Button(this).apply {
                text = "${name.ifBlank { "KZBS PhoneLink" }}  •  $host:$port"
                setTextColor(getColor(android.R.color.white))
                setBackgroundColor(getColor(android.R.color.darker_gray))
                setOnClickListener {
                    hostInput.setText(host)
                    codeInput.requestFocus()
                    appendLog("Bilgisayar bulundu: $host. Bilgisayardaki kodu gir.")
                }
            }
            discoveredList.addView(button)
        }
    }

    private fun missingPermissions(): List<String> {
        val requested = requiredPermissions.toMutableList()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) requested.add(Manifest.permission.POST_NOTIFICATIONS)
        return requested.distinct().filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
    }

    private fun isLocalHost(host: String): Boolean {
        if (!host.matches(Regex("^[0-9.]+$"))) return false
        val parts = host.split('.').mapNotNull { it.toIntOrNull() }
        if (parts.size != 4 || parts.any { it !in 0..255 }) return false
        return parts[0] == 10 || (parts[0] == 192 && parts[1] == 168) ||
            (parts[0] == 172 && parts[1] in 16..31) || (parts[0] == 169 && parts[1] == 254)
    }

    private fun connect(host: String, code: String) {
        connect(host, 4955, code, null)
    }

    private fun connect(host: String, port: Int, code: String, deviceId: String?) {
        val intent = Intent(this, PhoneLinkService::class.java).apply {
            action = PhoneLinkService.ACTION_CONNECT
            putExtra(PhoneLinkService.EXTRA_HOST, host)
            putExtra(PhoneLinkService.EXTRA_PORT, port)
            putExtra(PhoneLinkService.EXTRA_PAIRING_CODE, code)
            putExtra(PhoneLinkService.EXTRA_DEVICE_ID, deviceId)
        }
        startPhoneService(intent)
    }

    @Deprecated("QR scanner returns through the Android activity result API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == DIALER_ROLE_REQUEST_CODE) {
            if (resultCode == RESULT_OK) appendLog("PhoneLink arama denetimi etkinleştirildi.")
            else appendLog("Varsayılan telefon uygulaması değiştirilmedi; bilgisayardan gelişmiş arama tuşları çalışmayabilir.")
            updateDialerRoleStatus()
            return
        }
        val result = IntentIntegrator.parseActivityResult(requestCode, resultCode, data)
        if (result != null) {
            val contents = result.contents
            if (contents.isNullOrBlank()) {
                appendLog("QR tarama iptal edildi.")
            } else {
                try {
                    val uri = Uri.parse(contents)
                    val host = uri.getQueryParameter("host").orEmpty()
                    val code = uri.getQueryParameter("code").orEmpty()
                    val deviceId = uri.getQueryParameter("deviceId")
                    val port = uri.getQueryParameter("port")?.toIntOrNull() ?: 4955
                    if (uri.scheme != "phonelink" || uri.host != "pair" || !isLocalHost(host) || !code.matches(Regex("^\\d{6}$")) || port !in 1..65535) throw IllegalArgumentException()
                    val missing = missingPermissions()
                    if (missing.isNotEmpty()) {
                        pendingConnection = host to code
                        ActivityCompat.requestPermissions(this, missing.toTypedArray(), PERMISSION_REQUEST_CODE)
                    } else connect(host, port, code, deviceId)
                } catch (_: Exception) {
                    Toast.makeText(this, "PhoneLink eşleştirme QR kodu geçerli değil.", Toast.LENGTH_LONG).show()
                }
            }
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    private fun requestDialerRole() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            Toast.makeText(this, "Bilgisayardan arama denetimi Android 10 ve üzeri gerektirir.", Toast.LENGTH_LONG).show()
            return
        }
        val roleManager = getSystemService(RoleManager::class.java)
        if (!roleManager.isRoleAvailable(RoleManager.ROLE_DIALER)) {
            Toast.makeText(this, "Bu cihaz varsayılan telefon uygulaması seçimini desteklemiyor.", Toast.LENGTH_LONG).show()
            return
        }
        if (roleManager.isRoleHeld(RoleManager.ROLE_DIALER)) {
            updateDialerRoleStatus()
            Toast.makeText(this, "PhoneLink arama denetimi zaten etkin.", Toast.LENGTH_SHORT).show()
            return
        }
        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("Bilgisayardan arama denetimi")
            .setMessage("Aramayı bilgisayardan bitirmek, tuşlama yapmak, sessize almak ve Bluetooth ses yönünü seçmek için PhoneLink'in varsayılan telefon uygulaması olması gerekir. Android'in sistem onay ekranı açılacak.")
            .setNegativeButton("Şimdi değil", null)
            .setPositiveButton("Devam et") { _, _ ->
                startActivityForResult(roleManager.createRequestRoleIntent(RoleManager.ROLE_DIALER), DIALER_ROLE_REQUEST_CODE)
            }
            .show()
    }

    private fun updateDialerRoleStatus() {
        if (!::status.isInitialized) return
        val label = findViewById<TextView>(R.id.tvCallControlStatus)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val manager = getSystemService(RoleManager::class.java)
            label.text = if (manager.isRoleHeld(RoleManager.ROLE_DIALER)) {
                "PhoneLink arama denetimi etkin. Arama tuşları ve ses yönü bilgisayardan yönetilebilir."
            } else {
                "Bilgisayardan arama tuşları ve kapatma için PhoneLink'i varsayılan telefon uygulaması yap."
            }
        } else {
            label.text = "Bilgisayardan gelişmiş arama denetimi Android 10 ve üzeri cihazlarda kullanılabilir."
        }
    }

    private fun startPhoneService(intent: Intent) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent) else startService(intent)
        } catch (error: Exception) {
            status.text = "Bağlantı servisi başlatılamadı"
            appendLog("Servis başlatılamadı: ${error.localizedMessage ?: error.javaClass.simpleName}")
            Toast.makeText(this, "Bağlantı servisi başlatılamadı. İzinleri kontrol et.", Toast.LENGTH_LONG).show()
        }
    }

    @Deprecated("Deprecated by Android; retained for support across installed versions")
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != PERMISSION_REQUEST_CODE) return
        val denied = permissions.indices.filter { index -> grantResults.getOrNull(index) != PackageManager.PERMISSION_GRANTED }
        if (denied.isNotEmpty()) appendLog("Bazı izinler verilmedi. SMS, arama geçmişi veya rehber eşitlemesi kısıtlı olabilir.")
        else appendLog("Telefon izinleri verildi.")
        pendingConnection?.let { (host, code) ->
            pendingConnection = null
            connect(host, code)
        }
    }

    private fun requestBatteryOptimizationExemption() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val power = getSystemService(Context.POWER_SERVICE) as PowerManager
            if (!power.isIgnoringBatteryOptimizations(packageName)) {
                try {
                    startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
                } catch (_: Exception) {
                    startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                }
            } else Toast.makeText(this, "PhoneLink pil kısıtlamasından muaf.", Toast.LENGTH_SHORT).show()
        }
    }

    private fun checkForUpdate(manual: Boolean) {
        if (manual) appendLog("Güncelleme denetleniyor…")
        Thread {
            var connection: HttpURLConnection? = null
            try {
                connection = URL(UPDATE_MANIFEST_URL).openConnection() as HttpURLConnection
                connection.connectTimeout = 7000
                connection.readTimeout = 7000
                connection.setRequestProperty("Cache-Control", "no-cache")
                val manifest = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
                val androidInfo = manifest.optJSONObject("android") ?: JSONObject()
                val latest = androidInfo.optString("version", manifest.optString("version", BuildConfig.VERSION_NAME))
                val apkUrl = androidInfo.optString("url", "")
                val notes = manifest.optString("notes", "")
                val hasUpdate = compareVersions(latest, BuildConfig.VERSION_NAME) > 0 && apkUrl.startsWith("https://")
                runOnUiThread {
                    if (hasUpdate) {
                        currentUpdateVersion = latest
                        currentUpdateNotes = notes
                        updateText.text = "Yeni sürüm mevcut: v$latest"
                        updateBanner.visibility = View.VISIBLE
                        updateBanner.tag = apkUrl
                        val deferred = getSharedPreferences("updates", MODE_PRIVATE).getString("deferredAndroidVersion", null)
                        if (manual || (deferred != latest && updatePromptShownFor != latest)) {
                            updatePromptShownFor = latest
                            showUpdatePrompt(force = true)
                        }
                        if (manual) Toast.makeText(this, "PhoneLink v$latest güncellemesi hazır.", Toast.LENGTH_LONG).show()
                    } else if (manual) {
                        appendLog("Uygulama güncel (v${BuildConfig.VERSION_NAME}).")
                        Toast.makeText(this, "PhoneLink güncel.", Toast.LENGTH_SHORT).show()
                    }
                }
            } catch (_: Exception) {
                if (manual) runOnUiThread { appendLog("Güncelleme denetlenemedi. İnternet bağlantısını kontrol et.") }
            } finally {
                connection?.disconnect()
            }
        }.start()
    }

    private fun compareVersions(left: String, right: String): Int {
        val a = left.split('.').map { it.toIntOrNull() ?: 0 }
        val b = right.split('.').map { it.toIntOrNull() ?: 0 }
        for (index in 0 until maxOf(a.size, b.size)) {
            val delta = (a.getOrElse(index) { 0 }) - (b.getOrElse(index) { 0 })
            if (delta != 0) return delta.sign
        }
        return 0
    }

    private fun openUpdateDownload() {
        val url = updateBanner.tag as? String ?: return
        val uri = try { Uri.parse(url) } catch (_: Exception) { null }
        if (uri?.scheme != "https" || uri.host !in setOf("github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com")) {
            Toast.makeText(this, "Güvenli GitHub APK adresi bulunamadı.", Toast.LENGTH_LONG).show()
            return
        }
        try {
            val fileName = "KZBS-PhoneLink-v${currentUpdateVersion ?: "update"}.apk"
            val request = DownloadManager.Request(uri)
                .setTitle("KZBS PhoneLink v${currentUpdateVersion ?: "güncelleme"}")
                .setDescription("PhoneLink APK indiriliyor. Kurulumu indirme tamamlanınca sen başlatabilirsin.")
                .setMimeType("application/vnd.android.package-archive")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setAllowedOverMetered(true)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
            val manager = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            manager.enqueue(request)
            Toast.makeText(this, "APK İndirilenler klasörüne indiriliyor. Kurulumu indirme bildiriminden sen başlat.", Toast.LENGTH_LONG).show()
            appendLog("Güncelleme indiriliyor: $fileName")
        } catch (error: Exception) {
            Toast.makeText(this, "APK indirilemedi: ${error.localizedMessage ?: "bağlantıyı kontrol et"}", Toast.LENGTH_LONG).show()
        }
    }

    private fun showUpdatePrompt(force: Boolean) {
        val version = currentUpdateVersion ?: return
        if (updateBanner.tag !is String) return
        if (!force && updatePromptShownFor == version) return
        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("PhoneLink v$version güncellemesi")
            .setMessage((currentUpdateNotes.ifBlank { "Yeni güncelleme hazır. APK uygulama içinden indirilecek; kurulumu sen başlatacaksın." }) + "\n\nŞimdi indirilsin mi?")
            .setPositiveButton("Şimdi indir") { _, _ -> openUpdateDownload() }
            .setNegativeButton("Daha sonra") { _, _ ->
                getSharedPreferences("updates", MODE_PRIVATE).edit().putString("deferredAndroidVersion", version).apply()
                updateBanner.visibility = View.GONE
            }
            .setOnCancelListener {
                getSharedPreferences("updates", MODE_PRIVATE).edit().putString("deferredAndroidVersion", version).apply()
                updateBanner.visibility = View.GONE
            }
            .show()
    }

    private fun appendLog(message: String) {
        if (!::log.isInitialized) return
        val timestamp = SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date())
        val existing = log.text.toString().lineSequence().take(8).joinToString("\n")
        log.text = "[$timestamp] $message\n$existing".trim()
    }
}

private val Int.sign: Int get() = when {
    this < 0 -> -1
    this > 0 -> 1
    else -> 0
}
