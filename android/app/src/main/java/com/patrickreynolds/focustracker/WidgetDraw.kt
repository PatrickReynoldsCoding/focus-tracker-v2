package com.patrickreynolds.focustracker

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import kotlin.concurrent.thread

/** What the widgets share: fetching with a saved copy (Files and Single file), opening a file, settings, the header. */
object WidgetDraw {
    /** Request codes: each widget gets its own block, so their PendingIntents never replace each other's. */
    fun code(widgetId: Int, n: Int) = 100_000 + widgetId * 10 + n

    fun ids(context: Context, provider: Class<*>): IntArray =
        AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, provider))

    fun width(context: Context, widgetId: Int): WidgetSizes.Width =
        WidgetSizes.widthOf(AppWidgetManager.getInstance(context).getAppWidgetOptions(widgetId).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0))

    /** Open the app at a page of the web app, in the widget's profile. */
    fun openApp(context: Context, widgetId: Int, n: Int, fragment: String, profile: String?): PendingIntent =
        PendingIntent.getActivity(
            context, code(widgetId, n),
            Intent(context, MainActivity::class.java)
                .putExtra(MainActivity.EXTRA_FRAGMENT, fragment)
                .putExtra(MainActivity.EXTRA_PROFILE, profile ?: "")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    /** The template for rows that open a file (each row fills in fileIntent's extras). */
    fun openTemplate(context: Context, widgetId: Int): PendingIntent =
        PendingIntent.getActivity(
            context, code(widgetId, 2),
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
        )

    /** The Files widget's rows: one template for ticking an item and opening a file (WidgetTap). */
    fun tapTemplate(context: Context, widgetId: Int): PendingIntent =
        PendingIntent.getActivity(
            context, code(widgetId, 5),
            Intent(context, WidgetTapActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
        )

    /** A row's fill-in for openTemplate: the file's page, or a link's address in the browser. */
    fun fileIntent(f: WidgetFile, profile: String): Intent =
        if (f.route == null && f.url != null) Intent().putExtra(MainActivity.EXTRA_OPEN_URL, f.url)
        else Intent().putExtra(MainActivity.EXTRA_FRAGMENT, f.route ?: "/files").putExtra(MainActivity.EXTRA_PROFILE, profile)

    fun settings(context: Context, widgetId: Int): PendingIntent =
        PendingIntent.getActivity(
            context, code(widgetId, 3),
            Intent(context, WidgetSetupActivity::class.java)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), // its own task (taskAffinity ""), so the app's stays as it was
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    /** The header and the note under it, and smaller text and padding when narrow. With the profile removed, the title, the note and the empty list open the settings. */
    fun header(context: Context, v: RemoteViews, widgetId: Int, title: String, note: String?, width: WidgetSizes.Width) {
        v.setTextViewText(R.id.title, title)
        v.setTextViewText(R.id.note, note ?: "")
        v.setViewVisibility(R.id.note, if (note.isNullOrEmpty()) View.GONE else View.VISIBLE)
        v.setOnClickPendingIntent(R.id.settings, settings(context, widgetId))
        val removed = note == WidgetProfile.REMOVED
        v.setOnClickPendingIntent(R.id.note, if (removed) settings(context, widgetId) else null)
        v.setOnClickPendingIntent(R.id.empty, if (removed) settings(context, widgetId) else null)
        if (width == WidgetSizes.Width.NARROW) {
            val pad = dp(context, 7)
            v.setViewPadding(android.R.id.background, pad, pad, pad, pad)
            v.setTextViewTextSize(R.id.title, TypedValue.COMPLEX_UNIT_SP, 14f)
        }
    }

    fun dp(context: Context, n: Int) = (n * context.resources.displayMetrics.density).toInt()

    fun savedNote(store: WidgetStore, widgetId: Int): String =
        "Offline · saved " + java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT).format(java.util.Date(store.savedAt(widgetId)))

    /**
     * Fetch each widget's answer and draw it; when the server does not answer in time, draw the saved copy with a note.
     * One thread per widget, so several widgets fit in a broadcast's 10 seconds. Blocking: call off the main thread.
     */
    fun refresh(context: Context, ids: IntArray, path: (WidgetConfig) -> String, draw: (Int, WidgetConfig?, String?, String?, String?) -> Unit) {
        val prefs = Prefs(context)
        val store = WidgetStore(context)
        ids.map { id ->
            thread {
                val cfg = store.config(id)
                when {
                    cfg == null || cfg.mode.isEmpty() -> draw(id, null, null, null, null)
                    !prefs.ready -> draw(id, cfg, store.saved(id), "Open the app to connect", null)
                    else -> {
                        val fresh = runCatching { Api(prefs, fast = true, mode = cfg.mode).get(path(cfg)) }
                        fresh.onSuccess { store.save(id, it); draw(id, cfg, it, null, null) }
                        fresh.onFailure { e ->
                            val gone = (e as? ApiException)?.status == 404
                            val saved = store.saved(id)
                            when {
                                // Its profile was deleted: say so (never fall back to another profile).
                                WidgetProfile.isRemoved(e) -> draw(id, cfg, null, null, WidgetProfile.REMOVED)
                                gone -> draw(id, cfg, null, null, "Not found (deleted?) · ⚙ to choose again")
                                saved != null -> draw(id, cfg, saved, savedNote(store, id), null)
                                else -> draw(id, cfg, null, null, e.message ?: "Cannot reach the tracker")
                            }
                        }
                    }
                }
            }
        }.forEach { it.join() }
    }

    /** Redraw from the saved copies, without the network. */
    fun drawSaved(context: Context, ids: IntArray, draw: (Int, WidgetConfig?, String?, String?, String?) -> Unit) {
        val store = WidgetStore(context)
        for (id in ids) {
            val cfg = store.config(id)
            val saved = store.saved(id)
            if (cfg == null) draw(id, null, null, null, null) else if (saved != null) draw(id, cfg, saved, "Updating…", null)
        }
    }

    const val SET_UP = "Tap ⚙ to choose what it shows"
}
