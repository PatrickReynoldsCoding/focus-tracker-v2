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
 * The Today widget: focus project, session timer, and the to-dos
 * and habits left today. Tap a to-do to tick it, a habit to count a session.
 */
class TodayWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val pending = goAsync()
        thread {
            try {
                drawSaved(context) // something on screen at once, even when the server is slow
                refresh(context)
            } finally { pending.finish() }
        }
    }

    /** Resized: redraw so the compact layout switches on or off. */
    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, newOptions: android.os.Bundle) {
        val pending = goAsync()
        thread { try { drawSaved(context) } finally { pending.finish() } }
    }

    override fun onEnabled(context: Context) = RefreshWorker.schedule(context)

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        val action = intent.getStringExtra(EXTRA_ACTION) ?: return
        val id = intent.getStringExtra(EXTRA_ID)
        val pending = goAsync()
        thread {
            try {
                val api = Api(Prefs(context), fast = true)
                when (action) {
                    "todo" -> api.post("/api/todos/$id/tick", JSONObject().put("done", true))
                    "habit" -> api.post("/api/habits/$id/check", JSONObject().put("add", 1))
                    "start" -> api.post("/api/session/start")
                    "refresh" -> Unit
                }
            } catch (e: Exception) {
                android.os.Handler(context.mainLooper).post { Toast.makeText(context, "Focus Tracker: ${e.message}", Toast.LENGTH_SHORT).show() }
            } finally {
                refresh(context)
                pending.finish()
            }
        }
    }

    companion object {
        const val EXTRA_ACTION = "ft.action"
        const val EXTRA_ID = "ft.id"

        private fun broadcast(context: Context, action: String, code: Int): PendingIntent =
            PendingIntent.getBroadcast(
                context, code,
                Intent(context, TodayWidget::class.java).putExtra(EXTRA_ACTION, action),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

        private fun openApp(context: Context, fragment: String, code: Int): PendingIntent =
            PendingIntent.getActivity(
                context, code,
                Intent(context, MainActivity::class.java).putExtra(MainActivity.EXTRA_FRAGMENT, fragment).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

        /** Fetch the status and redraw every Today widget. Blocking: call off the main thread. When the server
         *  does not answer in time, the last saved status is drawn with a note, so the widget never just times out. */
        fun refresh(context: Context) {
            val prefs = Prefs(context)
            val fresh = if (prefs.ready) runCatching { Api(prefs, fast = true).status() } else Result.failure(IllegalStateException("Open the app to connect"))
            fresh.getOrNull()?.let { runCatching { AlarmScheduler.schedule(context, it) } } // also when no widget is placed
            val saved = if (fresh.isFailure) savedStatus(prefs) else null
            draw(context, saved?.let { Result.success(it) } ?: fresh, if (saved != null) "Offline · saved ${savedTime(prefs)}" else null)
        }

        /** Redraw from the saved status, without the network. */
        private fun drawSaved(context: Context) {
            val prefs = Prefs(context)
            savedStatus(prefs)?.let { draw(context, Result.success(it), "Updating…") }
        }

        private fun savedStatus(prefs: Prefs): Status? =
            prefs.cachedStatus.takeIf { it.isNotEmpty() }?.let { text -> runCatching { Status.parse(JSONObject(text)) }.getOrNull() }

        private fun savedTime(prefs: Prefs): String =
            java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT).format(java.util.Date(prefs.cachedAt))

        private fun draw(context: Context, status: Result<Status>, note: String?) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, TodayWidget::class.java))
            for (id in ids) manager.updateAppWidget(id, views(context, id, status, note))
        }

        private fun views(context: Context, widgetId: Int, result: Result<Status>, note: String?): RemoteViews {
            val v = RemoteViews(context.packageName, R.layout.widget_today)
            val width = AppWidgetManager.getInstance(context).getAppWidgetOptions(widgetId).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 250)
            val compact = width < 230 // about 3 cells wide
            if (compact) {
                val pad = (10 * context.resources.displayMetrics.density).toInt()
                v.setViewPadding(android.R.id.background, pad, pad, pad, pad)
                v.setTextViewTextSize(R.id.focus, android.util.TypedValue.COMPLEX_UNIT_SP, 16f)
                v.setTextViewTextSize(R.id.next, android.util.TypedValue.COMPLEX_UNIT_SP, 12f)
                v.setTextViewTextSize(R.id.timer, android.util.TypedValue.COMPLEX_UNIT_SP, 20f)
            }
            v.setOnClickPendingIntent(R.id.add, PendingIntent.getActivity(
                context, 3, Intent(context, QuickAddActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            ))
            val s = result.getOrElse { e ->
                v.setTextViewText(R.id.focus, "Focus Tracker")
                v.setTextViewText(R.id.next, e.message ?: "Cannot reach the tracker")
                v.setViewVisibility(R.id.next, View.VISIBLE)
                v.setViewVisibility(R.id.session_row, View.GONE)
                v.setOnClickPendingIntent(R.id.header, openApp(context, "/today", 1))
                v.setTextViewText(R.id.action, "Retry")
                v.setOnClickPendingIntent(R.id.action, broadcast(context, "refresh", 2))
                RemoteViewsCompat.setRemoteAdapter(context, v, widgetId, R.id.list, RemoteViewsCompat.RemoteCollectionItems.Builder().build())
                return v
            }
            v.setTextViewText(R.id.focus, s.focusName ?: "No focus yet")
            v.setOnClickPendingIntent(R.id.header, openApp(context, if (s.focusId != null) "/p/${s.focusId}" else "/today", 1))
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
                        session.waitingFor == "break" -> if (compact) "Break time · open" else "Time for a break · open to start it"
                        session.waitingFor != null -> if (compact) "Break over · open" else "Break over · open to start work"
                        p != null && left != null -> "${if (p == "break") "Break" else "Work"} · ${left / 60} min left"
                        else -> ""
                    },
                )
                v.setTextViewText(R.id.action, "Stop…")
                v.setOnClickPendingIntent(R.id.action, openApp(context, "/today", 4))
            } else {
                v.setViewVisibility(R.id.session_row, View.GONE)
                if (s.focusId != null) {
                    v.setTextViewText(R.id.action, "Start")
                    v.setOnClickPendingIntent(R.id.action, broadcast(context, "start", 5))
                } else {
                    v.setTextViewText(R.id.action, "Choose")
                    v.setOnClickPendingIntent(R.id.action, openApp(context, "/today", 6))
                }
            }
            val items = RemoteViewsCompat.RemoteCollectionItems.Builder().setHasStableIds(true).setViewTypeCount(1)
            var n = 0L
            fun add(kind: String, item: Status.Item, mark: String) {
                val row = RemoteViews(context.packageName, R.layout.widget_item)
                row.setTextViewText(R.id.mark, mark)
                row.setTextViewText(R.id.title, item.title)
                row.setTextViewText(R.id.detail, item.detail ?: "")
                row.setViewVisibility(R.id.detail, if (item.detail.isNullOrEmpty() || kind == "todo") View.GONE else View.VISIBLE)
                row.setOnClickFillInIntent(R.id.row, Intent().putExtra(EXTRA_ACTION, kind).putExtra(EXTRA_ID, item.id))
                items.addItem(n++, row)
            }
            s.todos.forEach { add("todo", it, "☐") }
            s.habits.forEach { add("habit", it, "+") }
            RemoteViewsCompat.setRemoteAdapter(context, v, widgetId, R.id.list, items.build())
            v.setEmptyView(R.id.list, R.id.empty)
            v.setPendingIntentTemplate(
                R.id.list,
                PendingIntent.getBroadcast(context, 7, Intent(context, TodayWidget::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE),
            )
            return v
        }
    }
}
