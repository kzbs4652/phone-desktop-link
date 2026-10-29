package com.kzbs.phonelink.service

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import android.telecom.TelecomManager
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.kzbs.phonelink.MainActivity
import com.kzbs.phonelink.R
import com.kzbs.phonelink.manager.CallLogsHelper
import com.kzbs.phonelink.manager.ContactsHelper
import com.kzbs.phonelink.manager.SmsHelper
import kotlinx.coroutines.*
import okhttp3.*
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress

class PhoneLinkService : Service() {

    companion object {
        const val TAG = "PhoneLinkService"
        const val NOTIFICATION_CHANNEL_ID = "kzbs_phonelink_channel"
        const val NOTIFICATION_ID = 4955
        var instance: PhoneLinkService? = null
    }

    private val gson = Gson()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val client = OkHttpClient.Builder().build()
    private var webSocket: WebSocket? = null
    private var pcHost: String? = null
    private var isConnected = false

    override fun onCreate() {
        super.onCreate()
        instance = this
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification("Bilgisayar aranıyor..."))
        startAutoDiscovery()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "KZBS PhoneLink Köprüsü",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Telefon ve Bilgisayar arasındaki canlı veri aktarım servisi"
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(statusText: String): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle("KZBS PhoneLink v1.0.0")
            .setContentText(statusText)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }

    private fun startAutoDiscovery() {
        scope.launch {
            while (isActive && !isConnected) {
                try {
                    val socket = DatagramSocket()
                    socket.broadcast = true
                    val message = "KZBS_DISCOVERY_PING".toByteArray()
                    val packet = DatagramPacket(
                        message,
                        message.size,
                        InetAddress.getByName("255.255.255.255"),
                        4956
                    )
                    socket.send(packet)

                    // Receive response
                    socket.soTimeout = 3000
                    val buffer = ByteArray(1024)
                    val recvPacket = DatagramPacket(buffer, buffer.size)
                    socket.receive(recvPacket)

                    val resp = String(recvPacket.data, 0, recvPacket.length)
                    if (resp.contains("KZBS PhoneLink")) {
                        pcHost = recvPacket.address.hostAddress
                        Log.i(TAG, "PC bulundu: $pcHost! WebSocket bağlantısı kuruluyor...")
                        connectWebSocket(pcHost!!)
                        socket.close()
                        break
                    }
                    socket.close()
                } catch (e: Exception) {
                    // Timeout or broadcast error, retry
                    delay(3000)
                }
            }
        }
    }

    private fun connectWebSocket(host: String) {
        val request = Request.Builder()
            .url("ws://$host:4955/phone")
            .build()

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                isConnected = true
                Log.i(TAG, "🟢 PC ile Canlı WebSocket Bağlantısı Kuruldu!")
                updateNotification("🟢 Bilgisayara Bağlı ($host)")
                sendHelloHandshake()
                syncContactsAndLogs()
            }

            override fun onMessage(ws: WebSocket, text: String) {
                handleIncomingPcCommand(text)
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                isConnected = false
                Log.w(TAG, "Bağlantı kapandı: $reason")
                updateNotification("🔴 Bağlantı Kesildi. Tekrar deneniyor...")
                reconnect()
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                isConnected = false
                Log.e(TAG, "WebSocket hatası: ${t.message}")
                reconnect()
            }
        })
    }

    private fun reconnect() {
        scope.launch {
            delay(4000)
            if (!isConnected) {
                startAutoDiscovery()
            }
        }
    }

    private fun updateNotification(text: String) {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun sendHelloHandshake() {
        val batteryStatus: Intent? = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level: Int = batteryStatus?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale: Int = batteryStatus?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val batteryPct = (level * 100 / scale.toFloat()).toInt()

        val hello = JsonObject().apply {
            addProperty("action", "DEVICE_HELLO")
            add("payload", JsonObject().apply {
                addProperty("deviceName", "${Build.MANUFACTURER.capitalize()} ${Build.MODEL}")
                addProperty("batteryLevel", batteryPct)
                addProperty("isCharging", true)
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
                "DIAL_CALL" -> {
                    val number = payload.get("number")?.asString ?: return
                    initiatePhoneCall(number)
                }
                "END_CALL" -> {
                    endActiveCall()
                }
                "SEND_SMS" -> {
                    val phone = payload.get("phone")?.asString ?: return
                    val text = payload.get("text")?.asString ?: return
                    SmsHelper.sendSms(this, phone, text)
                }
                "REQ_SYNC_ALL" -> {
                    syncContactsAndLogs()
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Command execution error: ${e.message}")
        }
    }

    private fun initiatePhoneCall(number: String) {
        try {
            val intent = Intent(Intent.ACTION_CALL).apply {
                data = Uri.parse("tel:${Uri.encode(number)}")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            startActivity(intent)
            Log.i(TAG, "Arama başlatıldı: $number")
        } catch (e: SecurityException) {
            Log.e(TAG, "Arama izni yok: ${e.message}")
        }
    }

    private fun endActiveCall() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val telecomManager = getSystemService(Context.TELECOM_SERVICE) as? TelecomManager
            try {
                telecomManager?.endCall()
            } catch (e: SecurityException) {
                Log.e(TAG, "Arama sonlandırılamadı: ${e.message}")
            }
        }
    }

    private fun syncContactsAndLogs() {
        scope.launch {
            try {
                val contacts = ContactsHelper.fetchContacts(this@PhoneLinkService)
                val contactsPayload = JsonObject().apply {
                    addProperty("action", "CONTACTS_SYNCED")
                    add("payload", gson.toJsonTree(contacts))
                }
                sendToPc(contactsPayload.toString())

                val callLogs = CallLogsHelper.fetchCallLogs(this@PhoneLinkService)
                val logsPayload = JsonObject().apply {
                    addProperty("action", "CALL_LOGS_SYNCED")
                    add("payload", gson.toJsonTree(callLogs))
                }
                sendToPc(logsPayload.toString())
            } catch (e: Exception) {
                Log.e(TAG, "Sync error: ${e.message}")
            }
        }
    }

    fun sendToPc(jsonString: String) {
        webSocket?.send(jsonString)
    }

    override fun onDestroy() {
        super.onDestroy()
        instance = null
        scope.cancel()
        webSocket?.close(1000, "Service destroyed")
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
