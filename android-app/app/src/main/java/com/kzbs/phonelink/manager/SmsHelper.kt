package com.kzbs.phonelink.manager

import android.content.Context
import android.telephony.SmsManager
import android.util.Log

object SmsHelper {
    fun sendSms(context: Context, phoneNumber: String, message: String): Boolean {
        return try {
            val smsManager: SmsManager = context.getSystemService(SmsManager::class.java)
                ?: SmsManager.getDefault()

            val parts = smsManager.divideMessage(message)
            if (parts.size > 1) {
                smsManager.sendMultipartTextMessage(phoneNumber, null, parts, null, null)
            } else {
                smsManager.sendTextMessage(phoneNumber, null, message, null, null)
            }
            Log.i("SmsHelper", "SMS basariyla gonderildi: $phoneNumber")
            true
        } catch (e: Exception) {
            Log.e("SmsHelper", "SMS gonderme hatasi: ${e.message}")
            false
        }
    }
}
