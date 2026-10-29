package com.kzbs.phonelink.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import com.google.gson.JsonObject
import com.kzbs.phonelink.service.PhoneLinkService

class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Telephony.Sms.Intents.SMS_RECEIVED_ACTION) {
            val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
            for (sms in messages) {
                val sender = sms.displayOriginatingAddress ?: "Bilinmeyen"
                val body = sms.displayMessageBody ?: ""

                val payload = JsonObject().apply {
                    addProperty("sender", sender)
                    addProperty("phone", sender)
                    addProperty("text", body)
                    addProperty("timestamp", System.currentTimeMillis())
                }

                val event = JsonObject().apply {
                    addProperty("action", "SMS_RECEIVED")
                    add("payload", payload)
                }

                // Push immediately to PC via active Foreground Service
                PhoneLinkService.instance?.sendToPc(event.toString())
            }
        }
    }
}
