package com.kzbs.phonelink.manager

import android.content.Context
import android.provider.ContactsContract

data class ContactItem(
    val id: String,
    val name: String,
    val phone: String,
    val avatar: String = "👤"
)

object ContactsHelper {
    fun fetchContacts(context: Context): List<ContactItem> {
        val list = mutableListOf<ContactItem>()
        val uri = ContactsContract.CommonDataKinds.Phone.CONTENT_URI
        val projection = arrayOf(
            ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER
        )

        try {
            val cursor = context.contentResolver.query(uri, projection, null, null, "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} ASC")
            cursor?.use {
                val idIdx = it.getColumnIndex(ContactsContract.CommonDataKinds.Phone.CONTACT_ID)
                val nameIdx = it.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
                val phoneIdx = it.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)

                while (it.moveToNext()) {
                    val id = if (idIdx != -1) it.getString(idIdx) else ""
                    val name = if (nameIdx != -1) it.getString(nameIdx) else "İsimsiz"
                    val phone = if (phoneIdx != -1) it.getString(phoneIdx) else ""

                    if (phone.isNotBlank()) {
                        list.add(ContactItem(id, name, phone))
                    }
                }
            }
        } catch (e: SecurityException) {
            // Permission denied fallback
        }
        return list
    }
}
