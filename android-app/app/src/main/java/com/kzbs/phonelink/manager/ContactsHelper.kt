package com.kzbs.phonelink.manager

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.ContactsContract.CommonDataKinds.Phone
import android.util.Log
import androidx.core.content.ContextCompat
import java.util.Locale

data class PhoneContact(
    val id: String,
    val name: String,
    val phone: String
)

data class ContactsReadResult(
    val contacts: List<PhoneContact>? = null,
    val errorMessage: String? = null
) {
    val isSuccess: Boolean get() = contacts != null && errorMessage == null
}

object ContactsHelper {
    fun fetchContacts(context: Context): ContactsReadResult {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
            return ContactsReadResult(errorMessage = "Kişi listesini göstermek için telefonda PhoneLink'e Rehber izni ver.")
        }

        val projection = arrayOf(Phone._ID, Phone.DISPLAY_NAME, Phone.NUMBER)
        val uniqueByNumber = LinkedHashMap<String, PhoneContact>()
        try {
            val cursor = context.contentResolver.query(
                Phone.CONTENT_URI,
                projection,
                null,
                null,
                "${Phone.DISPLAY_NAME} COLLATE LOCALIZED ASC, ${Phone.NUMBER} ASC"
            ) ?: return ContactsReadResult(errorMessage = "Telefonun kişi listesi açılamadı.")

            cursor.use {
                val idIndex = it.getColumnIndex(Phone._ID)
                val nameIndex = it.getColumnIndex(Phone.DISPLAY_NAME)
                val numberIndex = it.getColumnIndex(Phone.NUMBER)
                while (it.moveToNext()) {
                    val name = if (nameIndex >= 0) it.getString(nameIndex).orEmpty().trim() else ""
                    val number = if (numberIndex >= 0) it.getString(numberIndex).orEmpty().trim() else ""
                    if (name.isBlank() || number.isBlank()) continue
                    val id = if (idIndex >= 0) it.getString(idIndex).orEmpty() else ""
                    val dedupeKey = number.replace(Regex("[^0-9]"), "")
                    if (dedupeKey.isNotBlank()) {
                        uniqueByNumber.putIfAbsent(dedupeKey, PhoneContact(id, name, number))
                    }
                }
            }
        } catch (error: SecurityException) {
            Log.w("ContactsHelper", "Rehber izni verilmedi", error)
            return ContactsReadResult(errorMessage = "Kişi listesini göstermek için telefonda PhoneLink'e Rehber izni ver.")
        } catch (error: Exception) {
            Log.e("ContactsHelper", "Kişi listesi okunamadı: ${error.message}", error)
            return ContactsReadResult(errorMessage = "Telefonun kişi listesi okunamadı.")
        }

        val sortedContacts = uniqueByNumber.values.sortedWith { left, right ->
            val byName = left.name.lowercase(Locale("tr", "TR")).compareTo(right.name.lowercase(Locale("tr", "TR")))
            if (byName != 0) byName else left.phone.compareTo(right.phone)
        }
        return ContactsReadResult(contacts = sortedContacts)
    }
}
