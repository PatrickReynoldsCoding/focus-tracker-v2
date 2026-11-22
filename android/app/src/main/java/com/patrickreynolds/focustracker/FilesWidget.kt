package com.patrickreynolds.focustracker

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

/**
 * The Files widget, like Google Keep's: the notes, lists and to-dos of a folder, a tag or the whole
 * profile, newest first, each with its title and the start of what is in it (GET /api/widget/files).
 * Tap a file to open it in the app (in the widget's profile); tap a to-do's item to tick it (0.5.0; plain lists
 * have no ticks); ⚙ (or a long press on Android 12+) changes what it shows, and its profile.
 */
class FilesWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val pending = goAsync()
        thread {
            try {
                WidgetDraw.drawSaved(context, ids, drawer(context))
                refresh(context, ids)
            } finally { pending.finish() }
        }
    }

    /** Resized: redraw so the narrow layout switches on or off. */
    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, newOptions: Bundle) {
        val pending = goAsync()
        thread { try { WidgetDraw.drawSaved(context, intArrayOf(id), drawer(context)) } finally { pending.finish() } }
    }

    override fun onDeleted(context: Context, ids: IntArray) { ids.forEach { WidgetStore(context).forget(it) } }

    override fun onEnabled(context: Context) = RefreshWorker.schedule(context)

    /** A to-do's item ticked on the widget (WidgetTapActivity): shown ticked at once, sent in the widget's profile, then redrawn. */
    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        val tick = WidgetTap.Tick.from { intent.getStringExtra(it) } ?: return
        val store = WidgetStore(context)
        val cfg = store.config(tick.widgetId) ?: return
        val pending = goAsync()
        thread {
            try {
                store.saved(tick.widgetId)?.let { WidgetTap.markDone(it, tick.fileId, tick.itemId) }
                    ?.let { drawer(context)(tick.widgetId, cfg, it, "Saving…", null) }
                runCatching { Api(Prefs(context), fast = true, mode = cfg.mode).post(WidgetTap.tickPath(tick.itemId), WidgetTap.tickBody()) }
                    .onFailure { e -> android.os.Handler(context.mainLooper).post { Toast.makeText(context, "Not ticked: ${e.message}", Toast.LENGTH_SHORT).show() } }
                refresh(context, intArrayOf(tick.widgetId))
            } finally { pending.finish() }
        }
    }

    companion object {
        /** How many files a widget asks for (the server caps it at 50). */
        const val FILES = 30

        private val KIND_LABELS = mapOf("note" to "Note", "list" to "List", "todo" to "To-do", "project-note" to "Project notes", "whiteboard" to "Whiteboard", "link" to "Link")

        /** Fetch and redraw every Files widget (or those given). Blocking: call off the main thread. */
        fun refresh(context: Context, ids: IntArray = WidgetDraw.ids(context, FilesWidget::class.java)) =
            WidgetDraw.refresh(context, ids, { it.filesPath(FILES) }, drawer(context))

        private fun drawer(context: Context) = { id: Int, cfg: WidgetConfig?, json: String?, note: String?, error: String? ->
            AppWidgetManager.getInstance(context).updateAppWidget(id, views(context, id, cfg, json, note, error))
        }

        private fun views(context: Context, id: Int, cfg: WidgetConfig?, json: String?, note: String?, error: String?): RemoteViews {
            val width = WidgetDraw.width(context, id)
            val narrow = width == WidgetSizes.Width.NARROW
            val v = RemoteViews(context.packageName, R.layout.widget_files)
            val feed = json?.let { runCatching { FilesFeed.parse(JSONObject(it)) }.getOrNull() }
            val title = feed?.sourceName ?: cfg?.sourceName?.ifEmpty { null } ?: "Files"
            val message = when {
                cfg == null -> WidgetDraw.SET_UP
                error != null -> error
                feed?.missing == true -> "That ${if (cfg.source == "tag") "tag" else "folder"} is gone · ⚙ to choose another"
                else -> note
            }
            WidgetDraw.header(context, v, id, title, message, width)
            val removed = error == WidgetProfile.REMOVED
            v.setOnClickPendingIntent(R.id.title, if (removed) WidgetDraw.settings(context, id) else WidgetDraw.openApp(context, id, 1, cfg?.sourceRoute() ?: "/files", cfg?.mode))
            v.setTextViewText(R.id.empty, if (cfg == null || removed) "" else "No files here")
            val items = RemoteViewsCompat.RemoteCollectionItems.Builder().setHasStableIds(true).setViewTypeCount(1)
            feed?.files?.forEach { f ->
                val row = RemoteViews(context.packageName, R.layout.widget_file_row)
                row.setTextViewText(R.id.title, f.title)
                val meta = listOfNotNull(if (narrow) null else KIND_LABELS[f.kind], f.project).joinToString(" · ")
                row.setTextViewText(R.id.meta, meta)
                row.setViewVisibility(R.id.meta, if (meta.isEmpty()) View.GONE else View.VISIBLE)
                // A to-do's items each with a tick; a plain list or a note: its text.
                val ticks = if (f.kind == "todo") f.items.orEmpty() else emptyList()
                row.setTextViewText(R.id.text, if (ticks.isEmpty()) f.text else "")
                row.setViewVisibility(R.id.text, if (ticks.isEmpty() && f.text.isNotEmpty()) View.VISIBLE else View.GONE)
                row.removeAllViews(R.id.items)
                row.setViewVisibility(R.id.items, if (ticks.isEmpty()) View.GONE else View.VISIBLE)
                for (item in ticks) {
                    val t = RemoteViews(context.packageName, R.layout.widget_file_tick)
                    t.setTextViewText(R.id.mark, if (item.done) "☑" else "☐")
                    t.setTextViewText(R.id.label, item.title)
                    t.setTextColor(R.id.label, context.getColor(if (item.done) R.color.muted else R.color.fg))
                    if (narrow) t.setTextViewTextSize(R.id.label, TypedValue.COMPLEX_UNIT_SP, 12f)
                    if (!item.done) t.setOnClickFillInIntent(R.id.tick, WidgetTap.Tick(id, f.id, item.id).intent())
                    row.addView(R.id.items, t)
                }
                if (ticks.isNotEmpty() && f.more) row.addView(R.id.items, RemoteViews(context.packageName, R.layout.widget_file_more))
                if (narrow) {
                    val pad = WidgetDraw.dp(context, 7)
                    row.setViewPadding(R.id.row, pad, pad, pad, pad)
                    row.setTextViewTextSize(R.id.title, TypedValue.COMPLEX_UNIT_SP, 13f)
                    row.setTextViewTextSize(R.id.text, TypedValue.COMPLEX_UNIT_SP, 12f)
                }
                row.setOnClickFillInIntent(R.id.row, WidgetDraw.fileIntent(f, cfg?.mode ?: ""))
                items.addItem((f.kind + ":" + f.id).hashCode().toLong(), row)
            }
            RemoteViewsCompat.setRemoteAdapter(context, v, id, R.id.list, items.build())
            v.setEmptyView(R.id.list, R.id.empty)
            v.setPendingIntentTemplate(R.id.list, WidgetDraw.tapTemplate(context, id))
            return v
        }
    }
}
