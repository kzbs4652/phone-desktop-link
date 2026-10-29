package com.kzbs.phonelink.manager

import android.content.Context
import android.provider.CallLog

data class CallLogItem(
    val id: String,
    val name: String,
    val phone: String,
    val type: String, // 'incoming' | 'outgoing' | 'missed'
    val time: String,
    val duration: String,
    val date: String
)

object CallLogsHelper {
    fun fetchCallLogs(context: Context): List<CallLogItem> {
        val list = mutableListOf<CallLogItem>()
        val uri = CallLog.Calls.CONTENT_URI
        val projection = arrayOf(
            CallLog.Calls._ID,
            CallLog.Calls.CACHED_NAME,
            CallLog.Calls.NUMBER,
            CallLog.Calls.TYPE,
            CallLog.Calls.DATE,
            CallLog.Calls.DURATION
        )

        try {
            val cursor = context.contentResolver.query(
                uri, projection, null, null,
                "${CallLog.Calls.DATE} DESC LIMIT 50"
            )
            cursor?.use {
                val idIdx = it.getColumnIndex(CallLog.Calls._ID)
                val nameIdx = it.getColumnIndex(CallLog.Calls.CACHED_NAME)
                val numIdx = it.getColumnIndex(CallLog.Calls.NUMBER)
                val typeIdx = it.getColumnIndex(CallLog.Calls.TYPE)
                val dateIdx = it.getColumnIndex(CallLog.Calls.DATE)
                val durIdx = it.getColumnIndex(CallLog.Calls.DURATION)

                while (it.moveToNext()) {
                    val id = if (idIdx != -1) it.getString(idIdx) else ""
                    val name = if (nameIdx != -1 && it.getString(nameIdx) != null) it.getString(nameIdx) else "Bilinmeyen"
                    val phone = if (numIdx != -1) it.getString(numIdx) else ""
                    val typeVal = if (typeIdx != -1) it.getInt(typeIdx) else CallLog.Calls.INCOMING_TYPE
                    val dateVal = if (dateIdx != -1) it.getLong(dateIdx) else System.currentTimeMillis()
                    val durSec = if (durIdx != -1) it.getLong(durIdx) else 0L

                    val typeStr = when (typeVal) {
                        CallLog.Calls.MISSED_TYPE -> "missed"
                        CallLog.Calls.OUTGOING_TYPE -> "outgoing"
                        else -> "incoming"
                    }

                    val timeStr = java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault()).format(java.util.Date(dateVal))
                    val mins = String.format("%02d", durSec / 60)
                    val secs = String.format("%02d", durSec % 60)

                    list.add(CallLogItem(id, name, phone, typeStr, timeStr, "$mins:$secs", "Geçmiş"))
                }
            }
        } catch (e: SecurityException) {
            // Permission denied fallback
        }
        return list
    }
}
