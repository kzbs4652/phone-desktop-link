package com.kzbs.phonelink

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.app.DownloadManager
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
import android.widget.ProgressBar
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
        private const val UPDATE_INSTALL_SOURCE_REQUEST_CODE = 1003
        private const val PREF_PENDING_UPDATE_DOWNLOAD_ID = "pendingAndroidUpdateDownloadId"
        private const val PREF_PENDING_UPDATE_URL = "pendingAndroidUpdateUrl"
        private const val UPDATE_MANIFEST_URL = "https://raw.githubusercontent.com/kzbs4652/phone-desktop-link/main/version.json"
    }

    private val requiredPermissions = mutableListOf(
        Manifest.permission.RECEIVE_SMS,
        Manifest.permission.READ_SMS,
        Manifest.permission.SEND_SMS
    )

    private lateinit var status: TextView
    private lateinit var log: TextView
    private lateinit var hostInput: EditText
    private lateinit var codeInput: EditText
    private lateinit var discoveredList: LinearLayout
    private lateinit var updateBanner: LinearLayout
    private lateinit var updateText: TextView
    private lateinit var updateProgressText: TextView
    private lateinit var updateProgressBar: ProgressBar
    private var receiverRegistered = false
    private var pendingConnection: Pair<String, String>? = null
    private var currentUpdateVersion: String? = null
    private var currentUpdateNotes: String = ""
    private var updatePromptShownFor: String? = null
    private var pendingUpdateUrl: String? = null
    private var updateDownloadReceiverRegistered = false
    private var activeUpdateDownloadId = -1L
    private var handledUpdateDownloadId = -1L
    private val discoveredHosts = mutableSetOf<String>()
    private val updateHandler = Handler(Looper.getMainLooper())
    private val updateProgressPoll = object : Runnable {
        override fun run() = pollUpdateDownload()
    }
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

    private val updateDownloadReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != DownloadManager.ACTION_DOWNLOAD_COMPLETE) return
            val completedId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
            val expectedId = getSharedPreferences("updates", MODE_PRIVATE).getLong(PREF_PENDING_UPDATE_DOWNLOAD_ID, -1L)
            if (completedId == expectedId && completedId != -1L) handleUpdateDownloadComplete(completedId)
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
        updateProgressText = findViewById(R.id.tvUpdateProgressText)
        updateProgressBar = findViewById(R.id.progressUpdateDownload)
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

        findViewById<Button>(R.id.btnBatteryOptimization).setOnClickListener { requestBatteryOptimizationExemption() }
        findViewById<Button>(R.id.btnCheckUpdates).setOnClickListener { checkForUpdate(manual = true) }
        findViewById<Button>(R.id.btnDownloadUpdate).setOnClickListener { showUpdatePrompt(force = true) }
        findViewById<Button>(R.id.btnLaterUpdate).setOnClickListener {
            currentUpdateVersion?.let { getSharedPreferences("updates", MODE_PRIVATE).edit().putString("deferredAndroidVersion", it).apply() }
            updateBanner.visibility = View.GONE
        }

        status.text = "Bilgisayara bağlı değil"
        appendLog("Hazır. Önce bilgisayardaki PhoneLink uygulamasını aç.")
        val setupPrefs = getSharedPreferences("setup", MODE_PRIVATE)
        if (missingPermissions().isNotEmpty() && !setupPrefs.getBoolean("permissionsPrompted", false)) {
            setupPrefs.edit().putBoolean("permissionsPrompted", true).apply()
            appendLog("İlk kullanım için SMS izinleri istenecek.")
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
        if (!updateDownloadReceiverRegistered) {
            ContextCompat.registerReceiver(
                this,
                updateDownloadReceiver,
                IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
                ContextCompat.RECEIVER_EXPORTED
            )
            updateDownloadReceiverRegistered = true
        }
        checkPendingUpdateDownload()
        PhoneLinkService.instance?.announceCurrentStatus()
        updateHandler.removeCallbacks(periodicUpdateCheck)
        updateHandler.postDelayed(periodicUpdateCheck, 60 * 60 * 1000L)
    }

    override fun onStop() {
        updateHandler.removeCallbacks(periodicUpdateCheck)
        updateHandler.removeCallbacks(updateProgressPoll)
        if (receiverRegistered) {
            unregisterReceiver(serviceReceiver)
            receiverRegistered = false
        }
        if (updateDownloadReceiverRegistered) {
            unregisterReceiver(updateDownloadReceiver)
            updateDownloadReceiverRegistered = false
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
        if (requestCode == UPDATE_INSTALL_SOURCE_REQUEST_CODE) {
            val preferences = getSharedPreferences("updates", MODE_PRIVATE)
            val updateUrl = pendingUpdateUrl ?: preferences.getString(PREF_PENDING_UPDATE_URL, null)
            pendingUpdateUrl = null
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || packageManager.canRequestPackageInstalls()) {
                preferences.edit().remove(PREF_PENDING_UPDATE_URL).apply()
                updateUrl?.let { downloadUpdateApk(it) }
            } else {
                preferences.edit().remove(PREF_PENDING_UPDATE_URL).apply()
                Toast.makeText(this, "Güncellemeyi kurmak için PhoneLink'e bilinmeyen uygulama izni vermen gerekiyor.", Toast.LENGTH_LONG).show()
            }
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
        if (denied.isNotEmpty()) appendLog("SMS izinleri verilmedi; SMS eşitleme ve gönderme kısıtlı olabilir.")
        else appendLog("SMS izinleri verildi.")
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
                connection = URL("$UPDATE_MANIFEST_URL?_=${System.currentTimeMillis()}").openConnection() as HttpURLConnection
                connection.connectTimeout = 7000
                connection.readTimeout = 7000
                connection.setRequestProperty("Cache-Control", "no-cache, no-store")
                connection.setRequestProperty("Pragma", "no-cache")
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
            pendingUpdateUrl = url
            getSharedPreferences("updates", MODE_PRIVATE).edit().putString(PREF_PENDING_UPDATE_URL, url).apply()
            androidx.appcompat.app.AlertDialog.Builder(this)
                .setTitle("PhoneLink güncelleme izni")
                .setMessage("APK indirilince Android kurulum ekranını açabilmek için PhoneLink'in bu kaynaktan uygulama yüklemesine izin ver. Son yükleme onayını Android gösterecek.")
                .setPositiveButton("Ayarlara git") { _, _ ->
                    try {
                        startActivityForResult(
                            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")),
                            UPDATE_INSTALL_SOURCE_REQUEST_CODE
                        )
                    } catch (_: Exception) {
                        pendingUpdateUrl = null
                        getSharedPreferences("updates", MODE_PRIVATE).edit().remove(PREF_PENDING_UPDATE_URL).apply()
                        Toast.makeText(this, "Bu ayar açılamadı. Android ayarlarından PhoneLink için uygulama yükleme iznini aç.", Toast.LENGTH_LONG).show()
                    }
                }
                .setNegativeButton("Daha sonra") { _, _ ->
                    pendingUpdateUrl = null
                    getSharedPreferences("updates", MODE_PRIVATE).edit().remove(PREF_PENDING_UPDATE_URL).apply()
                }
                .show()
            return
        }
        downloadUpdateApk(url)
    }

    private fun downloadUpdateApk(url: String) {
        pendingUpdateUrl = null
        try {
            val uri = Uri.parse(url)
            val version = currentUpdateVersion ?: "update"
            val fileName = "KZBS-PhoneLink-v$version.apk"
            val request = DownloadManager.Request(uri)
                .setTitle("KZBS PhoneLink v$version")
                .setDescription("Güncelleme indiriliyor. İndirme bitince Android kurulum ekranı açılacak.")
                .setMimeType("application/vnd.android.package-archive")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setAllowedOverMetered(true)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
            val manager = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            val downloadId = manager.enqueue(request)
            activeUpdateDownloadId = downloadId
            getSharedPreferences("updates", MODE_PRIVATE).edit().putLong(PREF_PENDING_UPDATE_DOWNLOAD_ID, downloadId).apply()
            updateBanner.visibility = View.VISIBLE
            updateText.text = "Yeni sürüm mevcut: v$version"
            updateProgressBar.isIndeterminate = true
            updateProgressBar.progress = 0
            updateProgressBar.visibility = View.VISIBLE
            updateProgressText.text = "Güncelleme indiriliyor…"
            updateProgressText.visibility = View.VISIBLE
            updateHandler.removeCallbacks(updateProgressPoll)
            updateHandler.post(updateProgressPoll)
            Toast.makeText(this, "APK indiriliyor; bitince Android kurulum ekranı açılacak.", Toast.LENGTH_LONG).show()
            appendLog("Güncelleme indiriliyor: $fileName")
        } catch (error: Exception) {
            Toast.makeText(this, "APK indirilemedi: ${error.localizedMessage ?: "bağlantıyı kontrol et"}", Toast.LENGTH_LONG).show()
        }
    }

    private fun checkPendingUpdateDownload() {
        val downloadId = getSharedPreferences("updates", MODE_PRIVATE).getLong(PREF_PENDING_UPDATE_DOWNLOAD_ID, -1L)
        if (downloadId != -1L) {
            activeUpdateDownloadId = downloadId
            updateProgressText.visibility = View.VISIBLE
            updateProgressBar.visibility = View.VISIBLE
            updateHandler.removeCallbacks(updateProgressPoll)
            updateHandler.post(updateProgressPoll)
        }
    }

    private fun pollUpdateDownload() {
        val preferences = getSharedPreferences("updates", MODE_PRIVATE)
        if (activeUpdateDownloadId == -1L) activeUpdateDownloadId = preferences.getLong(PREF_PENDING_UPDATE_DOWNLOAD_ID, -1L)
        val downloadId = activeUpdateDownloadId
        if (downloadId == -1L) return

        val manager = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val cursor = manager.query(DownloadManager.Query().setFilterById(downloadId))
        if (cursor == null) {
            updateHandler.postDelayed(updateProgressPoll, 1000)
            return
        }
        cursor.use {
            if (!it.moveToFirst()) {
                updateHandler.postDelayed(updateProgressPoll, 1000)
                return
            }
            val status = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
            when (status) {
                DownloadManager.STATUS_PENDING, DownloadManager.STATUS_RUNNING, DownloadManager.STATUS_PAUSED -> {
                    val downloaded = it.getLong(it.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
                    val total = it.getLong(it.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
                    if (total > 0L) {
                        val percent = ((downloaded * 100L) / total).toInt().coerceIn(0, 100)
                        updateProgressBar.isIndeterminate = false
                        updateProgressBar.progress = percent
                        updateProgressText.text = "Güncelleme indiriliyor: %$percent"
                    } else {
                        updateProgressBar.isIndeterminate = true
                        updateProgressText.text = "Güncelleme indiriliyor…"
                    }
                    updateHandler.postDelayed(updateProgressPoll, 500)
                }
                DownloadManager.STATUS_SUCCESSFUL, DownloadManager.STATUS_FAILED -> handleUpdateDownloadComplete(downloadId)
                else -> updateHandler.postDelayed(updateProgressPoll, 1000)
            }
        }
    }

    private fun handleUpdateDownloadComplete(downloadId: Long) {
        if (downloadId == handledUpdateDownloadId) return
        val manager = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val cursor = manager.query(DownloadManager.Query().setFilterById(downloadId)) ?: return
        cursor.use {
            if (!it.moveToFirst()) return
            when (it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))) {
                DownloadManager.STATUS_SUCCESSFUL -> {
                    handledUpdateDownloadId = downloadId
                    activeUpdateDownloadId = -1L
                    updateHandler.removeCallbacks(updateProgressPoll)
                    val apkUri = manager.getUriForDownloadedFile(downloadId)
                    if (apkUri == null) {
                        appendLog("APK indirildi ama Android kurulum adresini açamadı.")
                        updateProgressText.text = "İndirme tamamlandı ancak kurulum dosyası açılamadı."
                        return
                    }
                    try {
                        val installIntent = Intent(Intent.ACTION_VIEW).apply {
                            setDataAndType(apkUri, "application/vnd.android.package-archive")
                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        }
                        startActivity(installIntent)
                        getSharedPreferences("updates", MODE_PRIVATE).edit().remove(PREF_PENDING_UPDATE_DOWNLOAD_ID).apply()
                        updateProgressBar.progress = 100
                        updateProgressBar.isIndeterminate = false
                        updateProgressText.text = "İndirme tamamlandı. Android kurulum ekranını onayla."
                        appendLog("İndirme tamamlandı. Android kurulum ekranını onayla.")
                    } catch (error: Exception) {
                        updateProgressText.text = "Kurulum ekranı açılamadı: ${error.localizedMessage ?: "bilinmeyen hata"}"
                        appendLog("Android kurulum ekranı açılamadı: ${error.localizedMessage ?: "bilinmeyen hata"}")
                    }
                }
                DownloadManager.STATUS_FAILED -> {
                    handledUpdateDownloadId = downloadId
                    activeUpdateDownloadId = -1L
                    updateHandler.removeCallbacks(updateProgressPoll)
                    val reason = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
                    getSharedPreferences("updates", MODE_PRIVATE).edit().remove(PREF_PENDING_UPDATE_DOWNLOAD_ID).apply()
                    updateProgressBar.visibility = View.GONE
                    updateProgressText.text = "İndirme başarısız oldu (hata $reason). Yeniden deneyebilirsin."
                    appendLog("Güncelleme indirilemedi (hata $reason). İnternet bağlantısını kontrol edip yeniden dene.")
                }
            }
        }
    }

    private fun showUpdatePrompt(force: Boolean) {
        val version = currentUpdateVersion ?: return
        if (updateBanner.tag !is String) return
        if (!force && updatePromptShownFor == version) return
        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("PhoneLink v$version güncellemesi")
            .setMessage((currentUpdateNotes.ifBlank { "Yeni sürüm hazır. APK indirilecek ve Android kurulum ekranı açılacak." }) + "\n\nŞimdi indirilsin mi?")
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
