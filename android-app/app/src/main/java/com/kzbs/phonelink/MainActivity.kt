package com.kzbs.phonelink

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.kzbs.phonelink.service.PhoneLinkService

class MainActivity : AppCompatActivity() {

    private val PERMISSION_REQUEST_CODE = 1001

    private val requiredPermissions = arrayOf(
        Manifest.permission.RECEIVE_SMS,
        Manifest.permission.READ_SMS,
        Manifest.permission.SEND_SMS,
        Manifest.permission.CALL_PHONE,
        Manifest.permission.READ_PHONE_STATE,
        Manifest.permission.READ_CALL_LOG,
        Manifest.permission.READ_CONTACTS
    )

    private lateinit var tvStatus: TextView
    private lateinit var tvLog: TextView
    private lateinit var btnToggleService: Button
    private lateinit var btnRequestPermissions: Button
    private lateinit var btnBatteryOpt: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        tvStatus = findViewById(R.id.tvConnectionStatus)
        tvLog = findViewById(R.id.tvLogStream)
        btnToggleService = findViewById(R.id.btnToggleService)
        btnRequestPermissions = findViewById(R.id.btnPermissions)
        btnBatteryOpt = findViewById(R.id.btnBatteryOptimization)

        btnRequestPermissions.setOnClickListener {
            checkAndRequestPermissions()
        }

        btnBatteryOpt.setOnClickListener {
            requestBatteryOptimizationExemption()
        }

        btnToggleService.setOnClickListener {
            toggleBridgeService()
        }

        checkAndRequestPermissions()
        startBridgeService()
    }

    private fun checkAndRequestPermissions() {
        val missingPermissions = mutableListOf<String>()
        for (perm in requiredPermissions) {
            if (ContextCompat.checkSelfPermission(this, perm) != PackageManager.PERMISSION_GRANTED) {
                missingPermissions.add(perm)
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                missingPermissions.add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }

        if (missingPermissions.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, missingPermissions.toTypedArray(), PERMISSION_REQUEST_CODE)
        } else {
            appendLog("✅ Tüm sistem izinleri onaylı.")
        }
    }

    private fun requestBatteryOptimizationExemption() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val intent = Intent()
            val packageName = packageName
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            if (!pm.isIgnoringBatteryOptimizations(packageName)) {
                intent.action = Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
                intent.data = Uri.parse("package:$packageName")
                startActivity(intent)
                appendLog("⚡ Pil optimizasyonu muafiyet isteği açıldı.")
            } else {
                Toast.makeText(this, "Zaten pil kısıtlamasından muaf!", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun startBridgeService() {
        val serviceIntent = Intent(this, PhoneLinkService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent)
        } else {
            startService(serviceIntent)
        }
        tvStatus.text = "🟢 Arka Plan Servisi Aktif (PC Aranıyor...)"
        appendLog("🚀 KZBS PhoneLink Servisi başlatıldı.")
    }

    private fun toggleBridgeService() {
        val serviceIntent = Intent(this, PhoneLinkService::class.java)
        stopService(serviceIntent)
        appendLog("🛑 Servis durduruldu.")
        tvStatus.text = "🔴 Köprü Duraklatıldı"
    }

    private fun appendLog(msg: String) {
        val current = tvLog.text.toString()
        val timestamp = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault()).format(java.util.Date())
        tvLog.text = "[$timestamp] $msg\n$current"
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PERMISSION_REQUEST_CODE) {
            val allGranted = grantResults.all { it == PackageManager.PERMISSION_GRANTED }
            if (allGranted) {
                appendLog("✅ Tüm izinler başarıyla verildi!")
            } else {
                appendLog("⚠️ Bazı izinler reddedildi. Bazı özellikler kısıtlanabilir.")
            }
        }
    }
}
