package com.kzbs.phonelink

import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.telecom.TelecomManager
import android.view.Gravity
import android.widget.Button
import android.widget.GridLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

/** Small ACTION_DIAL screen required when PhoneLink is selected as the phone app. */
class DialerActivity : AppCompatActivity() {
    private lateinit var number: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(22, 30, 22, 22)
            setBackgroundColor(Color.rgb(7, 11, 20))
        }
        number = TextView(this).apply { textSize = 26f; setTextColor(Color.WHITE); gravity = Gravity.CENTER; text = intent?.data?.schemeSpecificPart.orEmpty() }
        root.addView(number, LinearLayout.LayoutParams(-1, 72))
        val grid = GridLayout(this).apply { columnCount = 3 }
        listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#").forEach { digit ->
            grid.addView(Button(this).apply {
                text = digit
                setTextColor(Color.WHITE)
                setBackgroundColor(Color.rgb(33, 45, 67))
                setOnClickListener { number.append(digit) }
            }, GridLayout.LayoutParams().apply { width = 0; height = 58; columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f); setMargins(3, 3, 3, 3) })
        }
        root.addView(grid, LinearLayout.LayoutParams(-1, -2))
        val actions = LinearLayout(this).apply { gravity = Gravity.CENTER }
        actions.addView(Button(this).apply {
            text = "Sil"
            setOnClickListener { number.text = number.text.dropLast(1) }
        })
        actions.addView(Button(this).apply {
            text = "Ara"
            setOnClickListener {
                val value = number.text.toString().trim()
                if (value.isBlank()) return@setOnClickListener
                try {
                    (getSystemService(Context.TELECOM_SERVICE) as TelecomManager)
                        .placeCall(Uri.fromParts("tel", value, null), Bundle())
                } catch (error: Exception) {
                    Toast.makeText(this@DialerActivity, "Arama başlatılamadı: ${error.localizedMessage}", Toast.LENGTH_LONG).show()
                }
            }
        })
        root.addView(actions)
        setContentView(root)
    }
}
