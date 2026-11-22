package com.patrickreynolds.focustracker

import android.app.Activity
import android.os.Bundle
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import org.json.JSONObject
import java.time.LocalDate
import kotlin.concurrent.thread

/** A small dialog from the widget's "+": add a to-do for today. */
class QuickAddActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_quick_add)
        val input = findViewById<EditText>(R.id.title)
        val add = findViewById<Button>(R.id.add)
        var sent = false
        fun submit() {
            val title = input.text.toString().trim()
            // Enter on a keyboard reports the action twice (key down and up): send once.
            if (title.isEmpty() || sent) return
            sent = true
            add.isEnabled = false
            thread {
                val result = runCatching {
                    // The profile open in the app (not the widget's, not the server's default: owner, 0.5.0).
                    val prefs = Prefs(this)
                    TodayProfile.run(prefs) { mode -> Api(prefs, mode = mode).post("/api/todos", JSONObject().put("title", title).put("day", LocalDate.now().toString())) }
                }
                TodayWidget.refresh(this)
                runOnUiThread {
                    result.exceptionOrNull()?.let { Toast.makeText(this, "Not saved: ${it.message}", Toast.LENGTH_LONG).show() }
                        ?: Toast.makeText(this, "Added", Toast.LENGTH_SHORT).show()
                    finish()
                }
            }
        }
        add.setOnClickListener { submit() }
        input.setOnEditorActionListener { _, id, _ -> if (id == EditorInfo.IME_ACTION_DONE) { submit(); true } else false }
    }
}
