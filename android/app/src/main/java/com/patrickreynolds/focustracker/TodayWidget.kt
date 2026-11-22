package com.patrickreynolds.focustracker

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.view.View
import android.widget.RemoteViews
import android.widget.Toast
import androidx.core.widget.RemoteViewsCompat
import org.json.JSONObject
import kotlin.concurrent.thread

/**
 * The Today widget: focus project, session timer, and the Today list (the to-dos, cards and habits left today),
 * in the widget's own profile, chosen in its settings (WidgetSetupActivity; 0.5.0, D51). Tap a to-do or card to
 * tick it, a habit to count a session, ✕ to put it off for today (Not today). ⚙ changes the profile.
 */
class TodayWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val pending = goAsync()
        thread {
            try {
                drawSaved(context, ids) // something on screen at once, even when the server is slow
                refresh(context, ids)
            } finally { pending.finish() }
        }
    }

    /** Resized: redraw so the compact layout switches on or off. */
    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, newOptions: android.os.Bundle) {
        val pending = goAsync()
        thread { try { drawSaved(context, intArrayOf(id)) } finally { pending.finish() } }
    }

    override fun onDeleted(context: Context, ids: IntArray) { ids.forEach { WidgetStore(context).forget(it) } }

    override fun onEnabled(context: Context) = RefreshWorker.schedule(context)

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        val action = intent.getStringExtra(EXTRA_ACTION) ?: return
        val widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        if (action == "pinned") { pinned(context, widgetId, intent.getStringExtra(EXTRA_MODE)); return }
        val id = intent.getStringExtra(EXTRA_ID)
        val pending = goAsync()
        thread {
            try {
                // The widget's own profile (sent with the tap), so a tap never lands in another profile.
                val mode = intent.getStringExtra(EXTRA_MODE)?.ifEmpty { null } ?: WidgetProfile.of(WidgetStore(context).config(widgetId))
                if (mode != null || action == "refresh") {
                    val api = Api(Prefs(context), fast = true, mode = mode)
                    when (action) {
                        "todo" -> api.post("/api/todos/$id/tick", JSONObject().put("done", true))
                        "card" -> api.post("/api/tasks/$id/tick", JSONObject().put("done", true))
                        "habit" -> api.post("/api/habits/$id/check", JSONObject().put("add", 1))
                        "nottoday" -> when (val kind = intent.getStringExtra(EXTRA_KIND) ?: "todo") {
                            "habit" -> api.post("/api/habits/$id/not-today", JSONObject().put("on", true))
                            else -> api.post("/api/today/not-today", JSONObject().put("kind", kind).put("id", id).put("on", true))
                        }
                        "start" -> api.post("/api/session/start")
                        "refresh" -> Unit
                    }
                }
                // A session started here sets the next pomodoro alarm when it is in the app's profile (notifications follow the app's profile).
                if (action == "start") runCatching { RefreshWorker.runSoon(context) }
            } catch (e: Exception) {
                android.os.Handler(context.mainLooper).post { Toast.makeText(context, "Focus Tracker: ${e.message}", Toast.LENGTH_SHORT).show() }
            } finally {
                refresh(context)
                pending.finish()
            }
        }
    }

    /** Added with "Add widget" in the app (MainActivity.pinWidget): the app's open profile, unless its settings already chose one. */
    private fun pinned(context: Context, widgetId: Int, mode: String?) {
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID || mode.isNullOrEmpty()) return
        val store = WidgetStore(context)
        if (store.config(widgetId) == null) store.setConfig(widgetId, WidgetConfig(mode = mode))
        val pending = goAsync()
        thread { try { refresh(context, intArrayOf(widgetId)) } finally { pending.finish() } }
    }

    companion object {
        const val EXTRA_ACTION = "ft.action"
        const val EXTRA_ID = "ft.id"
        const val EXTRA_KIND = "ft.kind"
        const val EXTRA_MODE = "ft.mode"
        const val STATUS_PATH = "/api/status?client=android"

        /** The broadcast MainActivity.pinWidget asks Android to send once the widget is placed. */
        fun pinnedCallback(context: Context, mode: String): PendingIntent =
            PendingIntent.getBroadcast(
                context, 8,
                Intent(context, TodayWidget::class.java).putExtra(EXTRA_ACTION, "pinned").putExtra(EXTRA_MODE, mode),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE, // Android adds the widget's id
            )

        private fun broadcast(context: Context, widgetId: Int, action: String, n: Int, mode: String?): PendingIntent =
            PendingIntent.getBroadcast(
                context, WidgetDraw.code(widgetId, n),
                Intent(context, TodayWidget::class.java).putExtra(EXTRA_ACTION, action).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
                    .apply { if (mode != null) putExtra(EXTRA_MODE, mode) },
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

        fun ids(context: Context): IntArray = AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, TodayWidget::class.java))

        /**
         * Fetch each widget's profile's status (once per profile) and redraw those Today widgets. Blocking: call off the
         * main thread. When the server does not answer in time (or answers something unreadable), the widget's saved status
         * is drawn with a note saying why and when it was saved, so it never just times out or shows an empty list.
         */
        fun refresh(context: Context, ids: IntArray = ids(context)) {
            val prefs = Prefs(context)
            val store = WidgetStore(context)
            migrate(prefs, store, ids)
            for (id in ids) if (WidgetProfile.of(store.config(id)) == null) draw(context, id, null, Result.failure(NoProfile()), null)
            WidgetProfile.byProfile(ids) { store.config(it) }.map { (mode, widgets) ->
                thread {
                    val fresh: Result<String> = if (prefs.ready) runCatching { Api(prefs, fast = true, mode = mode).get(STATUS_PATH).also { Status.parse(JSONObject(it)) } }
                        else Result.failure(IllegalStateException("Open the app to connect"))
                    fresh.onSuccess { text -> widgets.forEach { store.save(it, text) }; runCatching { learnLabels(prefs, mode) } }
                    for (id in widgets) {
                        val error = fresh.exceptionOrNull()
                        val saved = if (error != null && !WidgetProfile.isRemoved(error)) savedStatus(store, id) else null
                        when {
                            error == null -> draw(context, id, mode, Result.success(Status.parse(JSONObject(fresh.getOrThrow()))), null)
                            saved != null -> draw(context, id, mode, Result.success(saved), TodayText.failure(error, savedTime(store, id)))
                            else -> draw(context, id, mode, Result.failure(error), null)
                        }
                    }
                }
            }.forEach { it.join() }
        }

        /** Once: Today widgets placed before 0.5.0 keep the profile they used last (WidgetProfile.migrate), with its saved status. */
        private fun migrate(prefs: Prefs, store: WidgetStore, ids: IntArray) {
            if (prefs.todayWidgetsMigrated) return
            val saved = prefs.cachedStatus.takeIf { it.isNotEmpty() }
            val savedMode = saved?.let { runCatching { Status.parse(JSONObject(it)).mode }.getOrNull() }
            val plan = WidgetProfile.migrate(ids, { store.config(it) != null }, prefs.appProfile, savedMode) {
                if (!prefs.ready) null else runCatching { JSONObject(Api(prefs, fast = true).get("/api/profiles")).optString("default") }.getOrNull()
            } ?: return // not known yet: drawn as "choose a profile" this time, tried again next time
            for ((id, mode) in plan) {
                store.setConfig(id, WidgetConfig(mode = mode))
                if (saved != null && savedMode == mode) store.save(id, saved, prefs.cachedAt)
            }
            prefs.todayWidgetsMigrated = true
        }

        /** Keep the profiles' labels (for "Nothing left today in Work"); asked only for a profile not seen before. */
        private fun learnLabels(prefs: Prefs, mode: String) {
            if (TodayProfile.labels(prefs.profileLabels).containsKey(mode)) return
            prefs.profileLabels = Api(prefs, fast = true).get("/api/profiles")
        }

        /** Redraw from the saved statuses, without the network. */
        private fun drawSaved(context: Context, ids: IntArray) {
            val store = WidgetStore(context)
            for (id in ids) {
                val mode = WidgetProfile.of(store.config(id)) ?: continue
                savedStatus(store, id)?.let { draw(context, id, mode, Result.success(it), "Updating…") }
            }
        }

        private fun savedStatus(store: WidgetStore, id: Int): Status? =
            store.saved(id)?.let { text -> runCatching { Status.parse(JSONObject(text)) }.getOrNull() }

        private fun savedTime(store: WidgetStore, id: Int): String =
            java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT).format(java.util.Date(store.savedAt(id)))

        private fun draw(context: Context, id: Int, mode: String?, status: Result<Status>, note: String?) =
            AppWidgetManager.getInstance(context).updateAppWidget(id, views(context, id, mode, status, note))

        private class NoProfile : Exception(WidgetProfile.CHOOSE)

        private fun views(context: Context, widgetId: Int, mode: String?, result: Result<Status>, note: String?): RemoteViews {
            val width = WidgetDraw.width(context, widgetId)
            val narrow = width == WidgetSizes.Width.NARROW // 2 cells: its own layout, the session row stacked
            val compact = width != WidgetSizes.Width.WIDE
            val v = RemoteViews(context.packageName, if (narrow) R.layout.widget_today_narrow else R.layout.widget_today)
            if (width == WidgetSizes.Width.COMPACT) {
                val pad = (10 * context.resources.displayMetrics.density).toInt()
                v.setViewPadding(android.R.id.background, pad, pad, pad, pad)
                v.setTextViewTextSize(R.id.focus, android.util.TypedValue.COMPLEX_UNIT_SP, 16f)
                v.setTextViewTextSize(R.id.next, android.util.TypedValue.COMPLEX_UNIT_SP, 12f)
                v.setTextViewTextSize(R.id.timer, android.util.TypedValue.COMPLEX_UNIT_SP, 20f)
            }
            // Quick add follows the app's open profile (owner, 0.5.0).
            v.setOnClickPendingIntent(R.id.add, PendingIntent.getActivity(
                context, 3, Intent(context, QuickAddActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            ))
            val settings = WidgetDraw.settings(context, widgetId)
            v.setOnClickPendingIntent(R.id.settings, settings)
            // Opening the app from the widget opens it in the widget's profile (the app switches to it; no widget changes).
            fun open(fragment: String, n: Int) = WidgetDraw.openApp(context, widgetId, n, fragment, mode)
            val s = result.getOrElse { e ->
                val choose = e is NoProfile || WidgetProfile.isRemoved(e)
                v.setTextViewText(R.id.focus, "Focus Tracker")
                v.setTextViewText(R.id.next, if (e is NoProfile) WidgetProfile.CHOOSE else if (choose) WidgetProfile.REMOVED else TodayText.noList(e))
                v.setTextViewText(R.id.empty, if (choose) "" else "Today’s list did not load")
                v.setViewVisibility(R.id.next, View.VISIBLE)
                v.setViewVisibility(R.id.session_row, View.GONE)
                v.setOnClickPendingIntent(R.id.header, if (choose) settings else open("/today", 1))
                v.setOnClickPendingIntent(R.id.empty, if (choose) settings else null)
                v.setTextViewText(R.id.action, if (choose) "Choose" else "Retry")
                v.setOnClickPendingIntent(R.id.action, if (choose) settings else broadcast(context, widgetId, "refresh", 2, mode))
                RemoteViewsCompat.setRemoteAdapter(context, v, widgetId, R.id.list, RemoteViewsCompat.RemoteCollectionItems.Builder().build())
                return v
            }
            v.setTextViewText(R.id.focus, s.focusName ?: "No focus yet")
            v.setOnClickPendingIntent(R.id.header, open(if (s.focusId != null) "/p/${s.focusId}" else "/today", 1))
            v.setTextViewText(R.id.next, note ?: "")
            v.setViewVisibility(R.id.next, if (note != null) View.VISIBLE else View.GONE)
            val session = s.session
            if (session != null) {
                v.setViewVisibility(R.id.session_row, View.VISIBLE)
                // A paused session's clock stands still.
                v.setChronometer(R.id.timer, SystemClock.elapsedRealtime() - session.elapsedSeconds * 1000, null, !session.paused)
                val p = session.pomodoroPhase
                val left = session.pomodoroSecondsLeft
                v.setTextViewText(
                    R.id.pomodoro,
                    when {
                        session.paused -> "Paused"
                        session.waitingFor == "break" -> if (narrow) "Break time" else if (compact) "Break time · open" else "Time for a break · open to start it"
                        session.waitingFor != null -> if (narrow) "Break over" else if (compact) "Break over · open" else "Break over · open to start work"
                        p != null && left != null -> "${if (p == "break") "Break" else "Work"} · ${left / 60} min${if (narrow) "" else " left"}"
                        else -> ""
                    },
                )
                v.setTextViewText(R.id.action, "Stop…")
                v.setOnClickPendingIntent(R.id.action, open("/today", 4))
            } else {
                v.setViewVisibility(R.id.session_row, View.GONE)
                if (s.focusId != null) {
                    v.setTextViewText(R.id.action, "Start")
                    v.setOnClickPendingIntent(R.id.action, broadcast(context, widgetId, "start", 5, mode))
                } else {
                    v.setTextViewText(R.id.action, "Choose")
                    v.setOnClickPendingIntent(R.id.action, open("/today", 6))
                }
            }
            val items = RemoteViewsCompat.RemoteCollectionItems.Builder().setHasStableIds(true).setViewTypeCount(1)
            var n = 0L
            for (item in s.items) {
                val row = RemoteViews(context.packageName, if (narrow) R.layout.widget_item_narrow else R.layout.widget_item)
                row.setTextViewText(R.id.mark, TodayText.mark(item.kind))
                row.setTextViewText(R.id.title, item.title)
                row.setTextViewText(R.id.detail, item.detail ?: "")
                row.setViewVisibility(R.id.detail, if (item.detail.isNullOrEmpty()) View.GONE else View.VISIBLE)
                val base = Intent().putExtra(EXTRA_ID, item.id).putExtra(EXTRA_KIND, item.kind).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
                    .apply { if (mode != null) putExtra(EXTRA_MODE, mode) }
                row.setOnClickFillInIntent(R.id.row, Intent(base).putExtra(EXTRA_ACTION, TodayText.tickAction(item.kind)))
                // ✕ = Not today (its own fill-in intent: a tap on it does not tick the row).
                row.setViewVisibility(R.id.skip, View.VISIBLE)
                row.setOnClickFillInIntent(R.id.skip, Intent(base).putExtra(EXTRA_ACTION, "nottoday"))
                items.addItem(n++, row)
            }
            RemoteViewsCompat.setRemoteAdapter(context, v, widgetId, R.id.list, items.build())
            v.setTextViewText(R.id.empty, TodayProfile.emptyText(mode ?: s.mode, TodayProfile.labels(Prefs(context).profileLabels)))
            v.setOnClickPendingIntent(R.id.empty, null)
            v.setEmptyView(R.id.list, R.id.empty)
            v.setPendingIntentTemplate(
                R.id.list,
                PendingIntent.getBroadcast(context, WidgetDraw.code(widgetId, 7), Intent(context, TodayWidget::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE),
            )
            return v
        }
    }
}
