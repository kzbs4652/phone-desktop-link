package com.kzbs.phonelink

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.telecom.Call
import android.telecom.VideoProfile
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.GridLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.gson.JsonObject
import com.kzbs.phonelink.service.PhoneInCallService

class InCallActivity : AppCompatActivity() {
    private lateinit var title: TextView
    private lateinit var state: TextView
    private lateinit var routeInfo: TextView
    private lateinit var actions: LinearLayout
    private lateinit var incomingActions: LinearLayout
    private lateinit var keypad: GridLayout
    private var receiverRegistered = false

    private val stateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) = renderCall()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        buildUi()
        renderCall()
    }

    override fun onStart() {
        super.onStart()
        if (!receiverRegistered) {
            ContextCompat.registerReceiver(
                this,
                stateReceiver,
                IntentFilter(PhoneInCallService.ACTION_CALL_STATE),
                ContextCompat.RECEIVER_NOT_EXPORTED
            )
            receiverRegistered = true
        }
        renderCall()
    }

    override fun onStop() {
        if (receiverRegistered) {
            unregisterReceiver(stateReceiver)
            receiverRegistered = false
        }
        super.onStop()
    }

    private fun buildUi() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(24, 40, 24, 24)
            setBackgroundColor(Color.rgb(7, 11, 20))
        }
        title = TextView(this).apply { textSize = 26f; setTextColor(Color.WHITE); gravity = Gravity.CENTER }
        state = TextView(this).apply { textSize = 16f; setTextColor(Color.rgb(0, 242, 254)); gravity = Gravity.CENTER; setPadding(0, 10, 0, 24) }
        routeInfo = TextView(this).apply { textSize = 13f; setTextColor(Color.LTGRAY); gravity = Gravity.CENTER; setPadding(0, 8, 0, 12) }
        actions = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER }
        keypad = GridLayout(this).apply {
            columnCount = 3
            visibility = android.view.View.GONE
            setPadding(0, 14, 0, 14)
        }
        incomingActions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        incomingActions.addView(actionButton("Yanıtla", Color.rgb(48, 209, 88)) { answerCall() })
        incomingActions.addView(actionButton("Reddet", Color.rgb(255, 69, 58)) { rejectCall() })
        val controls = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        controls.addView(actionButton("Sessiz", Color.rgb(39, 50, 74)) { toggleMute() })
        controls.addView(actionButton("Tuşlar", Color.rgb(39, 50, 74)) { toggleKeypad() })
        controls.addView(actionButton("PC Bluetooth", Color.rgb(39, 50, 74)) { choosePcAudio() })
        val callActions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        callActions.addView(actionButton("Beklet", Color.rgb(39, 50, 74)) { toggleHold() })
        callActions.addView(actionButton("Arama ekle", Color.rgb(39, 50, 74)) { addCall() })
        callActions.addView(actionButton("Kapat", Color.rgb(255, 69, 58)) { endCall() })

        root.addView(title, LinearLayout.LayoutParams(-1, -2))
        root.addView(state, LinearLayout.LayoutParams(-1, -2))
        root.addView(routeInfo, LinearLayout.LayoutParams(-1, -2))
        root.addView(incomingActions, LinearLayout.LayoutParams(-1, -2))
        root.addView(controls, LinearLayout.LayoutParams(-1, -2))
        root.addView(callActions, LinearLayout.LayoutParams(-1, -2))
        root.addView(keypad, LinearLayout.LayoutParams(-1, -2))
        setContentView(root)
        buildKeypad()
    }

    private fun actionButton(label: String, color: Int, action: () -> Unit): Button = Button(this).apply {
        text = label
        textSize = 12f
        setTextColor(Color.WHITE)
        setBackgroundColor(color)
        setOnClickListener { action() }
        layoutParams = LinearLayout.LayoutParams(0, 52, 1f).apply { setMargins(4, 8, 4, 8) }
    }

    private fun buildKeypad() {
        listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#").forEach { digit ->
            val button = Button(this).apply {
                text = digit
                textSize = 20f
                setTextColor(Color.WHITE)
                setBackgroundColor(Color.rgb(33, 45, 67))
                setOnClickListener { playDtmf(digit[0]) }
            }
            keypad.addView(button, GridLayout.LayoutParams().apply {
                width = 0
                height = 54
                columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f)
                setMargins(3, 3, 3, 3)
            })
        }
    }

    private fun renderCall() {
        val call = PhoneInCallService.currentCall
        if (call == null) {
            finish()
            return
        }
        val number = try { call.details.handle?.schemeSpecificPart.orEmpty() } catch (_: SecurityException) { "" }
        title.text = number.ifBlank { "Telefon araması" }
        val callState = call.details.state
        incomingActions.visibility = if (callState == Call.STATE_RINGING) android.view.View.VISIBLE else android.view.View.GONE
        state.text = when (callState) {
            Call.STATE_RINGING -> "Gelen arama"
            Call.STATE_DIALING, Call.STATE_CONNECTING -> "Aranıyor…"
            Call.STATE_ACTIVE -> "Görüşme sürüyor"
            Call.STATE_HOLDING -> "Arama beklemede"
            else -> "Arama durumu güncelleniyor"
        }
        routeInfo.text = "Ses yönü: ${PhoneInCallService.currentRoute}  •  ${if (PhoneInCallService.currentMuted) "Mikrofon sessizde" else "Mikrofon açık"}"
    }

    private fun answerCall() {
        PhoneInCallService.currentCall?.takeIf { it.details.state == Call.STATE_RINGING }
            ?.answer(VideoProfile.STATE_AUDIO_ONLY)
    }

    private fun rejectCall() {
        PhoneInCallService.currentCall?.takeIf { it.details.state == Call.STATE_RINGING }?.reject(false, null)
    }

    private fun endCall() { PhoneInCallService.handlePcCommand("END_CALL", JsonObject()) }

    private fun toggleMute() {
        val next = !PhoneInCallService.currentMuted
        PhoneInCallService.handlePcCommand("CALL_MUTE", JsonObject().apply { addProperty("muted", next) })
        renderCall()
    }

    private fun toggleKeypad() {
        keypad.visibility = if (keypad.visibility == android.view.View.VISIBLE) android.view.View.GONE else android.view.View.VISIBLE
    }

    private fun playDtmf(digit: Char) {
        PhoneInCallService.handlePcCommand("DTMF_TONE", JsonObject().apply { addProperty("digit", digit.toString()) })
    }

    private fun choosePcAudio() {
        val payload = JsonObject().apply { addProperty("route", "BLUETOOTH") }
        if (!PhoneInCallService.handlePcCommand("CALL_ROUTE", payload)) {
            Toast.makeText(this, "Telefonun kullanılabilir Bluetooth arama cihazı yok. Bilgisayarı Bluetooth arama cihazı olarak eşleştir.", Toast.LENGTH_LONG).show()
        }
        renderCall()
    }

    private fun toggleHold() {
        val held = PhoneInCallService.currentCall?.details?.state == Call.STATE_HOLDING
        PhoneInCallService.handlePcCommand(if (held) "CALL_UNHOLD" else "CALL_HOLD", JsonObject())
    }

    private fun addCall() {
        val input = EditText(this).apply { hint = "Telefon numarası"; inputType = android.text.InputType.TYPE_CLASS_PHONE }
        AlertDialog.Builder(this)
            .setTitle("Arama ekle")
            .setView(input)
            .setNegativeButton("Vazgeç", null)
            .setPositiveButton("Ara") { _, _ ->
                val number = input.text.toString().trim()
                if (number.isNotBlank()) {
                    PhoneInCallService.handlePcCommand("ADD_CALL", JsonObject().apply { addProperty("number", number) })
                }
            }
            .show()
    }
}
