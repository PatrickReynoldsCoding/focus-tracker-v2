package com.patrickreynolds.focustracker

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlin.concurrent.thread

/**
 * Wakes the app at the next pomodoro or "Time is up" moment so the notification is not up to
 * 15 minutes late (the worker only polls that often). Rescheduled whenever the status is fetched.
 */
object AlarmScheduler {
    private fun pending(context: Context): PendingIntent = PendingIntent.getBroadcast(
        context, 20, Intent(context, AlarmReceiver::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    /** Set (or clear) the alarm for what [status] says. Safe to call often: the same request id replaces the last one. */
    fun schedule(context: Context, status: Status) {
        val am = context.getSystemService(AlarmManager::class.java) ?: return
        val at = AlarmPlan.nextAlarmAt(status.session, System.currentTimeMillis())
        if (at == null) { am.cancel(pending(context)); return }
        val sdk = android.os.Build.VERSION.SDK_INT
        val canExact = sdk < 31 || am.canScheduleExactAlarms()
        try {
            when (AlarmPlan.method(sdk, canExact)) {
                AlarmPlan.Method.EXACT -> am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending(context))
                AlarmPlan.Method.ALARM_CLOCK -> {
                    val show = PendingIntent.getActivity(
                        context, 21, Intent(context, MainActivity::class.java),
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                    )
                    am.setAlarmClock(AlarmManager.AlarmClockInfo(at, show), pending(context))
                }
            }
        } catch (e: SecurityException) {
            // Permission taken away between the check and the call: inexact is better than nothing.
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending(context))
        }
    }
}

/** The alarm went off: show the alert now (the server decides what is due), then set the next alarm. */
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()
        val app = context.applicationContext
        thread {
            try {
                RefreshWorker.notifyNew(app) // fetches the status, notifies, and reschedules
                TodayWidget.refresh(app)
            } finally { pending.finish() }
        }
    }
}
