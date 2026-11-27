package com.patrickreynolds.focustracker

import android.app.AlarmManager
import android.app.Application
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.content.ContextCompat
import kotlin.concurrent.thread

/** When the widget tick runs next and how it is set. Pure, so it is unit-tested. */
object TickPlan {
    /** Screen on: redraw the widgets about every minute (D69). */
    const val SCREEN_ON_MS = 60_000L
    /** Screen off: no fetch, look again later. The alarm does not wake the phone, so it waits, overdue, until the screen comes on. */
    const val SCREEN_OFF_MS = 5 * 60_000L
    /** Screen on and unlock come a second or two apart, and the tick may follow a redraw the app asked for: one fetch for them all. */
    const val MIN_GAP_MS = 20_000L

    fun delayMs(screenOn: Boolean): Long = if (screenOn) SCREEN_ON_MS else SCREEN_OFF_MS

    enum class Method { EXACT, INEXACT }

    /** Exact when Android allows it (11: always; 12: unless switched off; 13+: USE_EXACT_ALARM), else inexact. */
    fun method(sdk: Int, canScheduleExact: Boolean): Method = if (sdk < 31 || canScheduleExact) Method.EXACT else Method.INEXACT
}

/**
 * One widget redraw at a time. A redraw that may be skipped (the tick, the screen coming on) is skipped while one is
 * running or when one started less than [minGapMs] ago. One that must happen (a change made in the app) waits for
 * the running one, then runs, so the change is fetched and two never run at once.
 */
class RefreshGate(private val clock: () -> Long, private val minGapMs: Long) {
    private val lock = Object()
    private var running = false
    private var lastStart: Long? = null

    /** Runs [work] on this thread, or not; returns whether it ran. */
    fun run(force: Boolean, work: () -> Unit): Boolean {
        synchronized(lock) {
            if (force) {
                while (running) lock.wait()
            } else {
                val last = lastStart
                if (running || (last != null && clock() - last < minGapMs)) return false
            }
            running = true
            lastStart = clock()
        }
        try {
            work()
        } finally {
            synchronized(lock) { running = false; lock.notifyAll() }
        }
        return true
    }
}

/**
 * Keeps the widgets fresh while the screen is on (D69), for changes made elsewhere (a computer, Claude): a
 * self-setting alarm about every minute ([WidgetTickReceiver]), and a redraw as soon as the screen comes on
 * ([ScreenReceiver], while the app's process is alive). Runs only while at least one widget is placed.
 * The 15-minute RefreshWorker stays as the fallback.
 */
object WidgetTicker {
    private const val ACTION_TICK = "com.patrickreynolds.focustracker.WIDGET_TICK"
    private const val ACTION_SCREEN = "com.patrickreynolds.focustracker.WIDGET_SCREEN_ON"

    val gate = RefreshGate(SystemClock::elapsedRealtime, TickPlan.MIN_GAP_MS)

    private fun pending(context: Context): PendingIntent = PendingIntent.getBroadcast(
        context, 30, Intent(context, WidgetTickReceiver::class.java).setAction(ACTION_TICK),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private val providers = listOf(TodayWidget::class.java, FilesWidget::class.java, SingleFileWidget::class.java)

    fun hasWidgets(context: Context): Boolean {
        val m = AppWidgetManager.getInstance(context) ?: return false
        return providers.any { m.getAppWidgetIds(ComponentName(context, it)).isNotEmpty() }
    }

    fun screenOn(context: Context): Boolean = context.getSystemService(PowerManager::class.java)?.isInteractive ?: true

    fun online(context: Context): Boolean {
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return true
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    /** A widget was placed or redrawn by Android, the phone started, the app was updated or opened: set the alarm (or clear it when no widget is left). */
    fun start(context: Context) {
        if (hasWidgets(context)) schedule(context, TickPlan.delayMs(screenOn(context))) else stop(context)
    }

    /** The last widget was removed (any provider's onDisabled): stop, unless another kind of widget is still placed. */
    fun stopIfNone(context: Context) { if (!hasWidgets(context)) stop(context) }

    private fun stop(context: Context) { context.getSystemService(AlarmManager::class.java)?.cancel(pending(context)) }

    /**
     * The next tick in [delayMs]. RTC, not RTC_WAKEUP: it never wakes a sleeping phone; when it falls due with the
     * screen off it is delivered when the phone next wakes, so the widgets are redrawn soon after the screen comes on.
     */
    fun schedule(context: Context, delayMs: Long) {
        val am = context.getSystemService(AlarmManager::class.java) ?: return
        val at = System.currentTimeMillis() + delayMs
        val sdk = android.os.Build.VERSION.SDK_INT
        val canExact = sdk < 31 || am.canScheduleExactAlarms()
        try {
            when (TickPlan.method(sdk, canExact)) {
                TickPlan.Method.EXACT -> am.setExactAndAllowWhileIdle(AlarmManager.RTC, at, pending(context))
                TickPlan.Method.INEXACT -> am.setAndAllowWhileIdle(AlarmManager.RTC, at, pending(context))
            }
        } catch (e: SecurityException) {
            am.setAndAllowWhileIdle(AlarmManager.RTC, at, pending(context)) // permission taken away between the check and the call
        }
    }

    /** Called from the screen receiver: hand the redraw to WidgetTickReceiver (a manifest receiver, with more time than a screen-on broadcast). */
    fun screenCameOn(context: Context) {
        context.sendBroadcast(Intent(context, WidgetTickReceiver::class.java).setAction(ACTION_SCREEN))
    }

    /** The tick: screen on → redraw (skipped when offline, running or just done) and again in a minute; screen off → no fetch, look again later. Blocking. */
    fun tick(context: Context) {
        if (!hasWidgets(context)) { stop(context); return }
        val on = screenOn(context)
        schedule(context, TickPlan.delayMs(on)) // first, so the chain goes on whatever the fetch does
        if (on && online(context)) gate.run(force = false) { RefreshWorker.drawAll(context) }
    }

    /** Listen for the screen coming on and unlocking while this process is alive (these broadcasts reach only receivers registered at runtime). */
    fun listen(app: Application) {
        val filter = IntentFilter().apply { addAction(Intent.ACTION_SCREEN_ON); addAction(Intent.ACTION_USER_PRESENT) }
        runCatching { ContextCompat.registerReceiver(app, ScreenReceiver(), filter, ContextCompat.RECEIVER_NOT_EXPORTED) }
    }
}

/** The alarm went off, or the screen came on: see WidgetTicker.tick. */
class WidgetTickReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()
        val app = context.applicationContext
        thread {
            try { runCatching { WidgetTicker.tick(app) } } finally { pending.finish() }
        }
    }
}

/** Screen on / unlocked (registered at runtime by FocusApp). */
class ScreenReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (WidgetTicker.hasWidgets(context)) WidgetTicker.screenCameOn(context.applicationContext)
    }
}

/** After the phone starts or the app is updated, alarms are gone (or may be): set the widget tick again. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> WidgetTicker.start(context.applicationContext)
        }
    }
}

/** The app's process: listens for the screen coming on (WidgetTicker.listen). */
class FocusApp : Application() {
    override fun onCreate() {
        super.onCreate()
        WidgetTicker.listen(this)
    }
}
