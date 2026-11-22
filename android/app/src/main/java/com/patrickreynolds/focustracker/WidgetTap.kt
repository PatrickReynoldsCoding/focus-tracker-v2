package com.patrickreynolds.focustracker

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import org.json.JSONObject
import java.net.URLEncoder

/**
 * A tap on a Files widget row (0.5.0). A collection widget has one tap template, and a row needs two actions (tick a
 * to-do's item, open the file), so the template is WidgetTapActivity, which shows nothing: it hands a tick to the
 * widget (a broadcast, FilesWidget.onReceive) or opens the file in the app (in the widget's profile) or a link in the browser.
 */
object WidgetTap {
    const val EXTRA_TAP = "ft.tap"
    const val TICK = "tick"
    const val EXTRA_WIDGET = "ft.widget"
    const val EXTRA_FILE = "ft.file"
    const val EXTRA_ITEM = "ft.item"

    /** Tick a to-do's item `itemId` (a card of to-do `fileId`) shown on Files widget `widgetId`. */
    data class Tick(val widgetId: Int, val fileId: String, val itemId: String) {
        fun extras(): Map<String, String> = mapOf(EXTRA_TAP to TICK, EXTRA_WIDGET to widgetId.toString(), EXTRA_FILE to fileId, EXTRA_ITEM to itemId)

        fun intent(): Intent = Intent().apply { extras().forEach { (k, v) -> putExtra(k, v) } }

        companion object {
            /** The tick an intent's extras describe, or null when it is not one. */
            fun from(extra: (String) -> String?): Tick? {
                if (extra(EXTRA_TAP) != TICK) return null
                val widget = extra(EXTRA_WIDGET)?.toIntOrNull() ?: return null
                return Tick(widget, extra(EXTRA_FILE) ?: "", extra(EXTRA_ITEM)?.ifEmpty { null } ?: return null)
            }
        }
    }

    /** The existing endpoint the Single file widget ticks with too (src/modules/todos.ts). */
    fun tickPath(itemId: String): String = "/api/todos/${URLEncoder.encode(itemId, "UTF-8").replace("+", "%20")}/tick"

    fun tickBody(): JSONObject = JSONObject().put("done", true)

    /** The saved Files feed with one to-do item shown ticked, drawn at once while the tick is sent. */
    fun markDone(json: String, fileId: String, itemId: String): String? = runCatching {
        val o = JSONObject(json)
        val files = o.optJSONArray("files") ?: return null
        var found = false
        for (i in 0 until files.length()) {
            val f = files.getJSONObject(i)
            if (f.optString("kind") != "todo" || (fileId.isNotEmpty() && f.optString("id") != fileId)) continue
            val items = f.optJSONArray("items") ?: continue
            for (j in 0 until items.length()) items.getJSONObject(j).takeIf { it.optString("id") == itemId }?.let { it.put("done", true); found = true }
        }
        if (found) o.toString() else null
    }.getOrNull()
}

/** Shows nothing: does what a Files widget row's tap asks (WidgetTap) and finishes at once. */
class WidgetTapActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val tick = WidgetTap.Tick.from { intent.getStringExtra(it) }
        val url = intent.getStringExtra(MainActivity.EXTRA_OPEN_URL)
        runCatching {
            when {
                tick != null -> sendBroadcast(tick.intent().setClass(this, FilesWidget::class.java))
                url != null -> Uri.parse(url).takeIf { it.scheme == "https" || it.scheme == "http" }
                    ?.let { startActivity(Intent(Intent.ACTION_VIEW, it).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                else -> startActivity(
                    Intent(this, MainActivity::class.java)
                        .putExtra(MainActivity.EXTRA_FRAGMENT, intent.getStringExtra(MainActivity.EXTRA_FRAGMENT) ?: "/files")
                        .putExtra(MainActivity.EXTRA_PROFILE, intent.getStringExtra(MainActivity.EXTRA_PROFILE) ?: "")
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
                )
            }
        }
        finish()
        @Suppress("DEPRECATION") overridePendingTransition(0, 0)
    }
}
