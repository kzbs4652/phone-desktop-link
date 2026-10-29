package com.kzbs.phonelink.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager
import com.google.gson.JsonObject
import com.kzbs.phonelink.service.PhoneLinkService

class CallStateReceiver : BroadcastReceiver() {
    companion object {
        private var lastState = TelephonyManager.CALL_STATE_IDLE
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == TelephonyManager.ACTION_PHONE_STATE_CHANGED) {
            val stateStr = intent.getStringExtra(TelephonyManager.EXTRA_STATE)
            val incomingNumber = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER) ?: "Bilinmeyen Numara"

            var status = "IDLE"
            when (stateStr) {
                TelephonyManager.EXTRA_STATE_RINGING -> status = "RINGING"
                TelephonyManager.EXTRA_STATE_OFFHOOK -> status = "ACTIVE"
                TelephonyManager.EXTRA_STATE_IDLE -> status = "ENDED"
            }

            val payload = JsonObject().apply {
                addProperty("status", status)
                addProperty("number", incomingNumber)
                addProperty("timestamp", System.currentTimeMillis())
            }

            val event = JsonObject().apply {
                addProperty("action", "CALL_STATE_CHANGED")
                add("payload", payload)
            }

            PhoneLinkService.instance?.sendToPc(event.toString())
        }
    }
}
