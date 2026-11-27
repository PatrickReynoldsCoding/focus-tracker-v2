package com.patrickreynolds.focustracker

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import android.widget.Toast
import androidx.core.widget.RemoteViewsCompat
import org.json.JSONObject
import kotlin.concurrent.thread

/** The rows a Single file widget draws for a file: a note's paragraphs, or a list's or to-do's items. */
object FileRows {
    data class Row(val text: String, val mark: String? = null, val itemId: String? = null, val done: Boolean = false, val more: Boolean = false)

    fun of(f: WidgetFile): List<Row> {
        val out = mutableListOf<Row>()
        val items = f.items
        if (items != null) {
            for (it in items) out += Row(it.title, if (f.kind == "todo") (if (it.done) "☑" else "☐") else "•", if (f.kind == "todo") it.id else null, it.done)
        } else {
            f.text.split(Regex("\n{2,}")).map { it.trim() }.filter { it.isNotEmpty() }.forEach { out += Row(it) }
        }
        if (f.more) out += Row("More in the app…", more = true)
        return out
    }
}

/**
 * The Single file widget: one note (its text) or list or to-do (its items), scrolling, cut to the
 * length chosen in its settings (GET /api/widget/file/:kind/:id). Tap a to-do's item to tick it
 * (or untick it); tap anything else, or the title, to open the file in the app.
 */
class SingleFileWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        WidgetTicker.start(context) // placed, redrawn every 30 minutes, or after the phone starts: keep the minute tick going
        val pending = goAsync()
        thread {
            try {
                WidgetDraw.drawSaved(context, ids, drawer(context))
                refresh(context, ids)
            } finally { pending.finish() }
        }
    }

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, newOptions: Bundle) {
        val pending = goAsync()
        thread { try { WidgetDraw.drawSaved(context, intArrayOf(id), drawer(context)) } finally { pending.finish() } }
    }

    override fun onDeleted(context: Context, ids: IntArray) { ids.forEach { WidgetStore(context).forget(it) } }

    override fun onEnabled(context: Context) {
        RefreshWorker.schedule(context)
        WidgetTicker.start(context)
    }

    /** The last widget of this kind was removed: the minute tick stops when no other kind is placed either. */
    override fun onDisabled(context: Context) = WidgetTicker.stopIfNone(context)

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.getStringExtra(EXTRA_ACTION) != "tick") return
        val widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        val item = intent.getStringExtra(EXTRA_ITEM) ?: return
        val done = !intent.getBooleanExtra(EXTRA_DONE, false)
        val store = WidgetStore(context)
        val cfg = store.config(widgetId) ?: return
        val pending = goAsync()
        thread {
            try {
                // On screen first: the saved copy with the item ticked, then the server's answer.
                store.saved(widgetId)?.let { flipped(it, item, done) }?.let { drawer(context)(widgetId, cfg, it, "Saving…", null) }
                runCatching { Api(Prefs(context), fast = true, mode = cfg.mode).post("/api/todos/$item/tick", JSONObject().put("done", done)) }
                    .onFailure { e -> android.os.Handler(context.mainLooper).post { Toast.makeText(context, "Not ticked: ${e.message}", Toast.LENGTH_SHORT).show() } }
                refresh(context, intArrayOf(widgetId))
            } finally { pending.finish() }
        }
    }

    companion object {
        private const val EXTRA_ACTION = "ft.action"
        private const val EXTRA_ITEM = "ft.item"
        private const val EXTRA_DONE = "ft.done"

        fun refresh(context: Context, ids: IntArray = WidgetDraw.ids(context, SingleFileWidget::class.java)) =
            WidgetDraw.refresh(context, ids, { it.filePath() }, drawer(context))

        /** The saved answer with one item ticked or unticked. */
        private fun flipped(json: String, item: String, done: Boolean): String? = runCatching {
            val o = JSONObject(json)
            val items = o.getJSONObject("file").optJSONArray("items") ?: return null
            for (i in 0 until items.length()) items.getJSONObject(i).takeIf { it.optString("id") == item }?.put("done", done)
            o.toString()
        }.getOrNull()

        private fun drawer(context: Context) = { id: Int, cfg: WidgetConfig?, json: String?, note: String?, error: String? ->
            AppWidgetManager.getInstance(context).updateAppWidget(id, views(context, id, cfg, json, note, error))
        }

        private fun views(context: Context, id: Int, cfg: WidgetConfig?, json: String?, note: String?, error: String?): RemoteViews {
            val width = WidgetDraw.width(context, id)
            val narrow = width == WidgetSizes.Width.NARROW
            val v = RemoteViews(context.packageName, R.layout.widget_files)
            val file = json?.let { runCatching { WidgetFile.parse(JSONObject(it).getJSONObject("file")) }.getOrNull() }
            WidgetDraw.header(context, v, id, file?.title ?: cfg?.fileTitle?.ifEmpty { null } ?: "File", if (cfg == null) WidgetDraw.SET_UP else error ?: note, width)
            val open = file?.let { WidgetDraw.fileIntent(it, cfg?.mode ?: "") }
            v.setOnClickPendingIntent(
                R.id.title,
                if (open?.hasExtra(MainActivity.EXTRA_FRAGMENT) == true) WidgetDraw.openApp(context, id, 1, open.getStringExtra(MainActivity.EXTRA_FRAGMENT)!!, cfg?.mode)
                else WidgetDraw.settings(context, id),
            )
            v.setTextViewText(R.id.empty, if (cfg == null || file == null) "" else "Empty")
            val todo = file?.kind == "todo"
            val items = RemoteViewsCompat.RemoteCollectionItems.Builder().setHasStableIds(true).setViewTypeCount(2)
            var n = 0L
            for (r in file?.let { FileRows.of(it) } ?: emptyList()) {
                val row: RemoteViews
                if (r.mark != null) {
                    row = RemoteViews(context.packageName, if (narrow) R.layout.widget_item_narrow else R.layout.widget_item)
                    row.setTextViewText(R.id.mark, r.mark)
                    row.setTextViewText(R.id.title, r.text)
                    row.setTextColor(R.id.title, context.getColor(if (r.done) R.color.muted else R.color.fg))
                    row.setViewVisibility(R.id.detail, View.GONE)
                } else {
                    row = RemoteViews(context.packageName, R.layout.widget_text_row)
                    row.setTextViewText(R.id.row, r.text)
                    if (r.more) row.setTextColor(R.id.row, context.getColor(R.color.muted))
                    if (narrow) row.setTextViewTextSize(R.id.row, TypedValue.COMPLEX_UNIT_SP, 12f)
                }
                val fill = when {
                    todo && r.itemId != null -> Intent().putExtra(EXTRA_ACTION, "tick").putExtra(EXTRA_ITEM, r.itemId).putExtra(EXTRA_DONE, r.done)
                        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
                    todo -> Intent().putExtra(EXTRA_ACTION, "none") // "More in the app…": the title opens it
                    else -> open ?: Intent()
                }
                row.setOnClickFillInIntent(R.id.row, fill)
                items.addItem(n++, row)
            }
            RemoteViewsCompat.setRemoteAdapter(context, v, id, R.id.list, items.build())
            v.setEmptyView(R.id.list, R.id.empty)
            // A to-do's rows tick (a broadcast to this widget); any other file's rows open it.
            v.setPendingIntentTemplate(
                R.id.list,
                if (todo) PendingIntent.getBroadcast(context, WidgetDraw.code(id, 4), Intent(context, SingleFileWidget::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
                else WidgetDraw.openTemplate(context, id),
            )
            return v
        }
    }
}
