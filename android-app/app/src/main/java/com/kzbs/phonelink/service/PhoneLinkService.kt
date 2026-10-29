package com.kzbs.phonelink.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.telecom.TelecomManager
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.kzbs.phonelink.BuildConfig
import com.kzbs.phonelink.MainActivity
import com.kzbs.phonelink.R
import com.kzbs.phonelink.manager.CallLogsHelper
import com.kzbs.phonelink.manager.ContactsHelper
import com.kzbs.phonelink.manager.SmsHelper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException
import java.net.URLEncoder

class PhoneLinkService : Service() {

    companion object {
        const val TAG = "PhoneLinkService"
        const val NOTIFICATION_CHANNEL_ID = "kzbs_phonelink_channel"
        const val NOTIFICATION_ID = 4955

        const val ACTION_DISCOVER = "com.kzbs.phonelink.DISCOVER_COMPUTERS"
        const val ACTION_CONNECT = "com.kzbs.phonelink.CONNECT_TO_COMPUTER"
        const val ACTION_AUTO_CONNECT = "com.kzbs.phonelink.AUTO_CONNECT"
        const val ACTION_DISCONNECT = "com.kzbs.phonelink.DISCONNECT_FROM_COMPUTER"
        const val ACTION_PC_DISCOVERED = "com.kzbs.phonelink.PC_DISCOVERED"
        const val ACTION_CONNECTION_STATUS = "com.kzbs.phonelink.CONNECTION_STATUS"
        const val EXTRA_HOST = "host"
        const val EXTRA_PORT = "port"
        const val EXTRA_NAME = "computerName"
        const val EXTRA_PAIRING_CODE = "pairingCode"
        const val EXTRA_DEVICE_ID = "deviceId"
        const val PAIRING_PREFS = "phone_link_pairing"
        const val PREF_HOST = "host"
        const val PREF_PORT = "port"
        const val PREF_DEVICE_ID = "deviceId"
        const val PREF_TOKEN = "token"

        var instance: PhoneLinkService? = null
    }

    private val gson = Gson()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val client = OkHttpClient.Builder().build()
    private var webSocket: WebSocket? = null
    private var pcHost: String? = null
    private var pcPort = 4955
    private var pairingCode: String? = null
    private var phoneToken: String? = null
    private var pcDeviceId: String? = null
    private var reconnectAttempts = 0
    private var isConnected = false
    private var isShuttingDown = false
    private var discoveryJob: Job? = null
    private var multicastLock: WifiManager.MulticastLock? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification("Bağlantı başlatılmadı"))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_DISCOVER -> {
                restorePairing()
                startDiscovery(startId)
            }
            ACTION_AUTO_CONNECT, null -> {
                restorePairing()
                isShuttingDown = false
                val token = phoneToken
                val host = pcHost
                if (!token.isNullOrBlank() && !host.isNullOrBlank()) connectWebSocket(host, pcPort, token, true)
                else if (!token.isNullOrBlank()) startPairedDeviceSearch()
                else broadcastStatus("Telefonu bir kez eşleştirerek devam et", false)
            }
            ACTION_CONNECT -> {
                val host = intent.getStringExtra(EXTRA_HOST)?.trim().orEmpty()
                val code = intent.getStringExtra(EXTRA_PAIRING_CODE)?.trim().orEmpty()
                val port = intent.getIntExtra(EXTRA_PORT, 4955)
                if (host.isNotBlank() && code.length == 6) {
                    discoveryJob?.cancel()
                    pcHost = host
                    pcPort = port
                    pairingCode = code
                    pcDeviceId = intent.getStringExtra(EXTRA_DEVICE_ID) ?: pcDeviceId
                    isShuttingDown = false
                    connectWebSocket(host, port, code, false)
                } else {
                    broadcastStatus("Bilgisayar adresini ve 6 haneli kodu kontrol et", false)
                }
            }
            ACTION_DISCONNECT -> {
                getSharedPreferences(PAIRING_PREFS, MODE_PRIVATE).edit().clear().apply()
                isShuttingDown = true
                webSocket?.close(1000, "Kullanıcı bağlantıyı kesti")
                stopSelf()
            }
            else -> broadcastStatus("Bağlantı bekleniyor", false)
        }
        return START_STICKY
    }

    private fun restorePairing() {
        val prefs = getSharedPreferences(PAIRING_PREFS, MODE_PRIVATE)
        pcHost = prefs.getString(PREF_HOST, pcHost)
        pcPort = prefs.getInt(PREF_PORT, pcPort)
        pcDeviceId = prefs.getString(PREF_DEVICE_ID, pcDeviceId)
        phoneToken = prefs.getString(PREF_TOKEN, phoneToken)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "KZBS PhoneLink bağlantısı",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Bilgisayar ve telefon arasındaki bağlantı durumu"
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(statusText: String): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle("KZBS PhoneLink v${BuildConfig.VERSION_NAME}")
            .setContentText(statusText)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }

    private fun startDiscovery(startId: Int) {
        if (isConnected) {
            broadcastStatus("Zaten bilgisayara bağlı", true, pcHost)
            return
        }
        if (!phoneToken.isNullOrBlank()) {
            startPairedDeviceSearch()
            return
        }
        if (discoveryJob?.isActive == true) return

        acquireMulticastLock()
        broadcastStatus("Aynı Wi-Fi ağındaki bilgisayarlar aranıyor…", false)
        updateNotification("Aynı Wi-Fi ağındaki bilgisayarlar aranıyor")

        discoveryJob = scope.launch {
            val expiresAt = System.currentTimeMillis() + 30_000
            while (isActive && !isConnected && !isShuttingDown && System.currentTimeMillis() < expiresAt) {
                try {
                    DatagramSocket().use { socket ->
                        socket.broadcast = true
                        socket.soTimeout = 450
                        val ping = "KZBS_DISCOVERY_PING".toByteArray()
                        socket.send(
                            DatagramPacket(
                                ping,
                                ping.size,
                                InetAddress.getByName("255.255.255.255"),
                                4956
                            )
                        )

                        val deadline = System.currentTimeMillis() + 1800
                        while (isActive && System.currentTimeMillis() < deadline) {
                            try {
                                val buffer = ByteArray(2048)
                                val packet = DatagramPacket(buffer, buffer.size)
                                socket.receive(packet)
                                val response = JSONObject(String(packet.data, 0, packet.length))
                                if (response.optString("app") == "KZBS PhoneLink") {
                                    val host = packet.address.hostAddress ?: continue
                                    val port = response.optInt("wsPort", 4955)
                                    val computerName = response.optString("computerName", "KZBS PhoneLink")
                                    broadcastComputerFound(host, port, computerName)
                                }
                            } catch (_: SocketTimeoutException) {
                                // Keep listening until this discovery round ends.
                            }
                        }
                    }
                } catch (error: Exception) {
                    Log.w(TAG, "Bilgisayar arama hatası: ${error.message}")
                }
                delay(1200)
            }
            if (!isConnected && !isShuttingDown && isActive) {
                broadcastStatus("Bilgisayar bulunamadı. Aynı Wi-Fi ağını kontrol et veya adresi elle gir.", false)
                stopSelfResult(startId)
            }
        }
    }

    private fun startPairedDeviceSearch() {
        if (discoveryJob?.isActive == true || isConnected || isShuttingDown) return
        val token = phoneToken ?: return
        val wantedDeviceId = pcDeviceId ?: return
        broadcastStatus("Eşleştirilmiş bilgisayar aynı Wi-Fi ağında aranıyor…", false, pcHost)
        updateNotification("Eşleştirilmiş bilgisayar aranıyor…")
        discoveryJob = scope.launch {
            while (isActive && !isConnected && !isShuttingDown) {
                acquireMulticastLock()
                try {
                    DatagramSocket().use { socket ->
                        socket.broadcast = true
                        socket.soTimeout = 500
                        val ping = "KZBS_DISCOVERY_PING".toByteArray()
                        socket.send(DatagramPacket(ping, ping.size, InetAddress.getByName("255.255.255.255"), 4956))
                        val deadline = System.currentTimeMillis() + 1800
                        while (isActive && !isConnected && System.currentTimeMillis() < deadline) {
                            try {
                                val buffer = ByteArray(2048)
                                val packet = DatagramPacket(buffer, buffer.size)
                                socket.receive(packet)
                                val response = JSONObject(String(packet.data, 0, packet.length))
                                if (response.optString("app") == "KZBS PhoneLink" && response.optString("deviceId") == wantedDeviceId) {
                                    val host = packet.address.hostAddress ?: continue
                                    val port = response.optInt("wsPort", 4955)
                                    pcHost = host
                                    pcPort = port
                                    connectWebSocket(host, port, token, true)
                                    return@launch
                                }
                            } catch (_: SocketTimeoutException) {
                                // Keep waiting briefly for other computers on this Wi-Fi.
                            }
                        }
                    }
                } catch (error: Exception) {
                    Log.w(TAG, "Eşleştirilmiş bilgisayar aranamadı: ${error.message}")
                } finally {
                    releaseMulticastLock()
                }
                delay(5000)
            }
        }
    }

    private fun acquireMulticastLock() {
        if (multicastLock?.isHeld == true) return
        try {
            val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            multicastLock = wifi.createMulticastLock("phonelink-discovery").apply {
                setReferenceCounted(false)
                acquire()
            }
        } catch (error: Exception) {
            Log.w(TAG, "Wi-Fi keşif kilidi alınamadı: ${error.message}")
        }
    }

    private fun broadcastComputerFound(host: String, port: Int, computerName: String) {
        sendBroadcast(
            Intent(ACTION_PC_DISCOVERED).setPackage(packageName)
                .putExtra(EXTRA_HOST, host)
                .putExtra(EXTRA_PORT, port)
                .putExtra(EXTRA_NAME, computerName)
        )
    }

    private fun connectWebSocket(host: String, port: Int, secret: String, tokenAuth: Boolean) {
        if (webSocket != null && !isConnected) {
            webSocket?.cancel()
            webSocket = null
        }
        acquireMulticastLock()
        broadcastStatus("$host adresindeki bilgisayara bağlanıyor…", false, host)
        updateNotification("Bilgisayara bağlanıyor…")

        pcHost = host
        pcPort = port
        getSharedPreferences(PAIRING_PREFS, MODE_PRIVATE).edit()
            .putString(PREF_HOST, host)
            .putInt(PREF_PORT, port)
            .apply()

        val encodedSecret = URLEncoder.encode(secret, Charsets.UTF_8.name())
        val authParameter = if (tokenAuth) "token" else "code"
        val request = Request.Builder()
            .url("ws://$host:$port/phone?$authParameter=$encodedSecret")
            .build()

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                isConnected = true
                reconnectAttempts = 0
                discoveryJob?.cancel()
                discoveryJob = null
                releaseMulticastLock()
                Log.i(TAG, "Bilgisayara bağlandı: $host")
                broadcastStatus("Bilgisayara bağlı: $host", true, host)
                updateNotification("Bilgisayara bağlı ($host)")
                sendHelloHandshake()
                syncPhoneData()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleIncomingPcCommand(text)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                this@PhoneLinkService.isConnected = false
                this@PhoneLinkService.webSocket = null
                releaseMulticastLock()
                if (!isShuttingDown) {
                    broadcastStatus("Bilgisayar bağlantısı kesildi", false, host)
                    updateNotification("Bağlantı kesildi")
                    reconnect()
                }
            }

            override fun onFailure(webSocket: WebSocket, error: Throwable, response: Response?) {
                this@PhoneLinkService.isConnected = false
                this@PhoneLinkService.webSocket = null
                releaseMulticastLock()
                val message = if (response?.code == 403 && tokenAuth) {
                    "Telefon eşleşmesi bilgisayarda sıfırlandı. Yeni QR koduyla tekrar eşleştir."
                } else if (response?.code == 403) {
                    "Eşleştirme kodu yanlış veya süresi dolmuş. Bilgisayardaki yeni kodu tara."
                } else {
                    "Bağlantı kurulamadı. Bilgisayarın açık ve aynı Wi-Fi'de olduğunu kontrol et."
                }
                broadcastStatus(message, false, host)
                updateNotification("Bağlantı kurulamadı")
                if (!isShuttingDown && response?.code == 403 && tokenAuth) {
                    getSharedPreferences(PAIRING_PREFS, MODE_PRIVATE).edit().clear().apply()
                    phoneToken = null
                    pcDeviceId = null
                } else if (!isShuttingDown && response?.code != 403) reconnect()
            }
        })
    }

    private fun reconnect() {
        scope.launch {
            delay(4000)
            if (isConnected || isShuttingDown) return@launch
            val token = phoneToken
            if (!token.isNullOrBlank()) {
                reconnectAttempts += 1
                if (reconnectAttempts % 3 == 0) startPairedDeviceSearch()
                else pcHost?.let { connectWebSocket(it, pcPort, token, true) } ?: startPairedDeviceSearch()
            } else {
                val code = pairingCode ?: return@launch
                val host = pcHost ?: return@launch
                connectWebSocket(host, pcPort, code, false)
            }
        }
    }

    private fun broadcastStatus(message: String, connected: Boolean, host: String? = null) {
        sendBroadcast(
            Intent(ACTION_CONNECTION_STATUS).setPackage(packageName)
                .putExtra("message", message)
                .putExtra("connected", connected)
                .putExtra(EXTRA_HOST, host)
        )
    }

    fun announceCurrentStatus() {
        val message = if (isConnected) "Bilgisayara bağlı: ${pcHost.orEmpty()}" else "Bilgisayara bağlı değil"
        broadcastStatus(message, isConnected, pcHost)
    }

    private fun updateNotification(text: String) {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun releaseMulticastLock() {
        try {
            multicastLock?.let { if (it.isHeld) it.release() }
        } catch (_: Exception) {
        } finally {
            multicastLock = null
        }
    }

    private fun sendHelloHandshake() {
        val batteryStatus = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = batteryStatus?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = batteryStatus?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val batteryPct = if (level >= 0 && scale > 0) level * 100 / scale else -1
        val chargingStatus = batteryStatus?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val isCharging = chargingStatus == BatteryManager.BATTERY_STATUS_CHARGING ||
            chargingStatus == BatteryManager.BATTERY_STATUS_FULL

        val hello = JsonObject().apply {
            addProperty("action", "DEVICE_HELLO")
            add("payload", JsonObject().apply {
                addProperty("deviceName", "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}")
                addProperty("batteryLevel", batteryPct)
                addProperty("isCharging", isCharging)
            })
        }
        sendToPc(hello.toString())
    }

    private fun handleIncomingPcCommand(rawJson: String) {
        try {
            val json = gson.fromJson(rawJson, JsonObject::class.java)
            val action = json.get("action")?.asString ?: return
            val payload = json.getAsJsonObject("payload") ?: JsonObject()

            when (action) {
                "PAIRING_COMPLETE" -> {
                    val token = payload.get("token")?.asString.orEmpty()
                    val deviceId = payload.get("deviceId")?.asString.orEmpty()
                    if (token.isNotBlank() && deviceId.isNotBlank()) {
                        phoneToken = token
                        pcDeviceId = deviceId
                        pairingCode = null
                        getSharedPreferences(PAIRING_PREFS, MODE_PRIVATE).edit()
                            .putString(PREF_TOKEN, token)
                            .putString(PREF_DEVICE_ID, deviceId)
                            .putString(PREF_HOST, pcHost)
                            .putInt(PREF_PORT, pcPort)
                            .apply()
                        broadcastStatus("Telefon bu bilgisayarla eşleştirildi. Otomatik bağlanma açık.", true, pcHost)
                        updateNotification("Eşleştirme tamamlandı; otomatik bağlantı açık")
                    }
                }
                "DIAL_CALL" -> {
                    val number = payload.get("number")?.asString.orEmpty()
                    val started = initiatePhoneCall(number)
                    sendActionResult("DIAL_CALL", started, if (started) null else "Arama başlatılamadı")
                }
                "END_CALL" -> {
                    val ended = PhoneInCallService.handlePcCommand("END_CALL", payload) || endActiveCall()
                    sendActionResult("END_CALL", ended, if (ended) null else "Arama bu telefonda sonlandırılamadı")
                }
                "ADD_CALL" -> {
                    val number = payload.get("number")?.asString.orEmpty()
                    val started = if (PhoneInCallService.currentCall != null) {
                        PhoneInCallService.handlePcCommand("ADD_CALL", payload)
                    } else initiatePhoneCall(number)
                    sendActionResult("ADD_CALL", started, if (started) null else "Ek arama başlatılamadı")
                }
                "DTMF_TONE", "CALL_MUTE", "CALL_ROUTE", "CALL_HOLD", "CALL_UNHOLD" -> {
                    val handled = PhoneInCallService.handlePcCommand(action, payload)
                    val error = when (action) {
                        "CALL_ROUTE" -> "Telefonda uygun Bluetooth arama ses aygıtı bulunamadı veya rota değiştirilemedi"
                        "CALL_HOLD", "CALL_UNHOLD" -> "Telefon veya operatör bu aramada bekletmeyi desteklemiyor"
                        else -> "Arama denetimi için telefonda PhoneLink arama denetimini etkinleştir"
                    }
                    sendActionResult(action, handled, if (handled) null else error)
                }
                "SEND_SMS" -> {
                    val phone = payload.get("phone")?.asString.orEmpty()
                    val text = payload.get("text")?.asString.orEmpty()
                    val queued = SmsHelper.sendSms(this, phone, text)
                    val result = JsonObject().apply {
                        addProperty("action", "SMS_SEND_RESULT")
                        add("payload", JsonObject().apply {
                            addProperty("success", queued)
                            addProperty("phone", phone)
                            addProperty("text", text)
                        })
                    }
                    sendToPc(result.toString())
                }
                "REQ_SYNC_ALL" -> syncPhoneData()
            }
        } catch (error: Exception) {
            Log.e(TAG, "Bilgisayar komutu işlenemedi: ${error.message}")
        }
    }

    private fun sendActionResult(action: String, success: Boolean, error: String?) {
        val result = JsonObject().apply {
            addProperty("action", "PHONE_ACTION_RESULT")
            add("payload", JsonObject().apply {
                addProperty("command", action)
                addProperty("success", success)
                if (error != null) addProperty("error", error)
            })
        }
        sendToPc(result.toString())
    }

    private fun initiatePhoneCall(number: String): Boolean {
        if (number.isBlank()) return false
        return try {
            val telecomManager = getSystemService(Context.TELECOM_SERVICE) as TelecomManager
            telecomManager.placeCall(android.net.Uri.fromParts("tel", number, null), Bundle.EMPTY)
            true
        } catch (error: Exception) {
            Log.e(TAG, "Arama başlatılamadı: ${error.message}")
            false
        }
    }

    private fun endActiveCall(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val telecomManager = getSystemService(Context.TELECOM_SERVICE) as? TelecomManager
            try {
                return telecomManager?.endCall() == true
            } catch (error: SecurityException) {
                Log.e(TAG, "Arama sonlandırılamadı: ${error.message}")
            }
        }
        return false
    }

    private fun syncPhoneData() {
        scope.launch {
            try {
                val contacts = ContactsHelper.fetchContacts(this@PhoneLinkService)
                sendSyncPayload("CONTACTS_SYNCED", gson.toJsonTree(contacts))

                val callLogs = CallLogsHelper.fetchCallLogs(this@PhoneLinkService)
                sendSyncPayload("CALL_LOGS_SYNCED", gson.toJsonTree(callLogs))

                val messages = SmsHelper.fetchInbox(this@PhoneLinkService)
                sendSyncPayload("SMS_SYNCED", gson.toJsonTree(messages))
            } catch (error: Exception) {
                Log.e(TAG, "Telefon verileri eşitlenemedi: ${error.message}")
            }
        }
    }

    private fun sendSyncPayload(action: String, payload: com.google.gson.JsonElement) {
        val event = JsonObject().apply {
            addProperty("action", action)
            add("payload", payload)
        }
        sendToPc(event.toString())
    }

    fun sendToPc(jsonString: String) {
        webSocket?.send(jsonString)
    }

    override fun onDestroy() {
        isShuttingDown = true
        discoveryJob?.cancel()
        if (isConnected) broadcastStatus("Bilgisayar bağlantısı kesildi", false, pcHost)
        releaseMulticastLock()
        webSocket?.close(1000, "Kullanıcı bağlantıyı kesti")
        webSocket = null
        isConnected = false
        instance = null
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
