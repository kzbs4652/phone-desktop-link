package com.kzbs.phonelink.manager

import android.content.Context
import android.content.pm.PackageManager
import android.provider.Telephony
import android.telephony.SmsManager
import android.util.Log
import androidx.core.content.ContextCompat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class SmsInboxItem(
    val id: String,
    val sender: String,
    val phone: String,
    val timestamp: String,
    val text: String,
    val code: String?,
    val unread: Boolean,
    val isOutgoing: Boolean = false
)

data class SmsInboxReadResult(
    val messages: List<SmsInboxItem>? = null,
    val errorCode: String? = null,
    val errorMessage: String? = null
) {
    val isSuccess: Boolean get() = messages != null && errorCode == null
}

object SmsHelper {
    /** Reads the full SMS store, including sent messages, in newest-first order. */
    fun fetchInbox(context: Context): SmsInboxReadResult {
        if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) {
            return SmsInboxReadResult(
                errorCode = "permission_denied",
                errorMessage = "SMS okuma izni verilmemiş. Telefonda PhoneLink için SMS iznini açıp yeniden eşitle."
            )
        }

        val items = mutableListOf<SmsInboxItem>()
        val projection = arrayOf(
            Telephony.Sms._ID,
            Telephony.Sms.ADDRESS,
            Telephony.Sms.BODY,
            Telephony.Sms.DATE,
            Telephony.Sms.READ,
            Telephony.Sms.TYPE
        )

        try {
            val cursor = context.contentResolver.query(
                Telephony.Sms.CONTENT_URI,
                projection,
                null,
                null,
                "${Telephony.Sms.DATE} DESC"
            ) ?: return SmsInboxReadResult(
                errorCode = "provider_unavailable",
                errorMessage = "Telefonun SMS kutusu açılamadı. Telefonda PhoneLink'i yeniden açıp tekrar dene."
            )
            cursor.use {
                val idIndex = cursor.getColumnIndex(Telephony.Sms._ID)
                val addressIndex = cursor.getColumnIndex(Telephony.Sms.ADDRESS)
                val bodyIndex = cursor.getColumnIndex(Telephony.Sms.BODY)
                val dateIndex = cursor.getColumnIndex(Telephony.Sms.DATE)
                val readIndex = cursor.getColumnIndex(Telephony.Sms.READ)
                val typeIndex = cursor.getColumnIndex(Telephony.Sms.TYPE)
                val timeFormatter = SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.getDefault())
                val codePattern = Regex("\\b\\d{4,8}\\b")

                while (cursor.moveToNext()) {
                    val body = if (bodyIndex >= 0) cursor.getString(bodyIndex).orEmpty() else ""
                    val address = if (addressIndex >= 0) cursor.getString(addressIndex).orEmpty() else ""
                    val date = if (dateIndex >= 0) cursor.getLong(dateIndex) else 0L
                    val type = if (typeIndex >= 0) cursor.getInt(typeIndex) else Telephony.Sms.MESSAGE_TYPE_INBOX
                    val isOutgoing = type == Telephony.Sms.MESSAGE_TYPE_SENT ||
                        type == Telephony.Sms.MESSAGE_TYPE_OUTBOX ||
                        type == Telephony.Sms.MESSAGE_TYPE_FAILED ||
                        type == Telephony.Sms.MESSAGE_TYPE_QUEUED ||
                        type == Telephony.Sms.MESSAGE_TYPE_DRAFT
                    items.add(
                        SmsInboxItem(
                            id = if (idIndex >= 0) cursor.getString(idIndex).orEmpty() else "$date-$address",
                            sender = if (isOutgoing) "Ben" else address.ifBlank { "Bilinmeyen" },
                            phone = address,
                            timestamp = timeFormatter.format(Date(date)),
                            text = body,
                            code = codePattern.find(body)?.value,
                            unread = !isOutgoing && readIndex >= 0 && cursor.getInt(readIndex) == 0,
                            isOutgoing = isOutgoing
                        )
                    )
                }
            }
        } catch (error: SecurityException) {
            Log.w("SmsHelper", "SMS okuma izni verilmedi", error)
            return SmsInboxReadResult(
                errorCode = "permission_denied",
                errorMessage = "SMS okuma izni yok. Telefonda PhoneLink için SMS iznini açıp yeniden eşitle."
            )
        } catch (error: Exception) {
            Log.e("SmsHelper", "SMS kutusu okunamadı: ${error.message}", error)
            return SmsInboxReadResult(
                errorCode = "read_failed",
                errorMessage = "SMS kutusu okunamadı. Telefonu ve izinleri kontrol edip yeniden eşitle."
            )
        }

        return SmsInboxReadResult(messages = items)
    }

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
