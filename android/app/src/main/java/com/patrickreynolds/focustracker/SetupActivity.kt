package com.patrickreynolds.focustracker

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.webkit.CookieManager
import android.widget.Button
import android.widget.EditText
import android.widget.RadioGroup
import android.widget.TextView
import kotlin.concurrent.thread

/** First run: the tracker's address and the owner's password. Makes an API token for the widgets. */
class SetupActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_setup)
        val prefs = Prefs(this)
        val url = findViewById<EditText>(R.id.url)
        val password = findViewById<EditText>(R.id.password)
        val mode = findViewById<RadioGroup>(R.id.mode)
        val error = findViewById<TextView>(R.id.error)
        val connect = findViewById<Button>(R.id.connect)
        url.setText(prefs.url)
        mode.check(if (prefs.mode == "work") R.id.mode_work else R.id.mode_personal)
        connect.setOnClickListener {
            var address = url.text.toString().trim().trimEnd('/')
            if (address.isNotEmpty() && !address.startsWith("http")) address = "https://$address"
            if (address.isEmpty() || password.text.isEmpty()) return@setOnClickListener
            connect.isEnabled = false
            error.text = ""
            thread {
                val result = runCatching { Api.connect(address, password.text.toString(), "Android (${Build.MODEL})") }
                runOnUiThread {
                    connect.isEnabled = true
                    result.onSuccess { (token, cookie) ->
                        prefs.url = address
                        prefs.token = token
                        prefs.mode = if (mode.checkedRadioButtonId == R.id.mode_work) "work" else "personal"
                        CookieManager.getInstance().setCookie(address, cookie)
                        CookieManager.getInstance().flush()
                        startActivity(Intent(this, MainActivity::class.java))
                        finish()
                    }.onFailure { error.text = it.message ?: "Could not connect" }
                }
            }
        }
    }
}
