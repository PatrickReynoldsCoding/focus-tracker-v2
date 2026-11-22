package com.patrickreynolds.focustracker

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Every 15 minutes (session alerts have their own exact alarm, see AlarmScheduler): redraw the widgets (Today, Files,
 * Single file; each in its own profile) and show new reminders as notifications (each once), in the app's open profile.
 */
class RefreshWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        TodayWidget.refresh(applicationContext)
        FilesWidget.refresh(applicationContext)
        SingleFileWidget.refresh(applicationContext)
        notifyNew(applicationContext)
        return Result.success()
    }

    companion object {
        private const val CHANNEL = "reminders"

        fun schedule(context: Context) {
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                "refresh", ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<RefreshWorker>(15, TimeUnit.MINUTES).build(),
            )
        }

        /** Once, as soon as WorkManager can (a session started from a widget: its alarm, within a broadcast's few seconds). */
        fun runSoon(context: Context) {
            WorkManager.getInstance(context).enqueueUniqueWork("refresh-now", ExistingWorkPolicy.REPLACE, OneTimeWorkRequestBuilder<RefreshWorker>().build())
        }

        /** Set the next pomodoro / "Time is up" alarm from the app's open profile (the notifications' profile). Blocking. */
        fun scheduleAlarm(context: Context) {
            val prefs = Prefs(context)
            if (!prefs.ready) return
            runCatching { AlarmScheduler.schedule(context, TodayProfile.run(prefs) { mode -> Api(prefs, fast = true, mode = mode).status() }) }
        }

        /** New reminders and alerts as notifications, in the app's open profile (TodayProfile); also sets the next alarm. */
        fun notifyNew(context: Context) {
            val prefs = Prefs(context)
            if (!prefs.ready) return
            val status = runCatching { TodayProfile.run(prefs) { mode -> Api(prefs, mode = mode).status() } }.getOrNull() ?: return
            val api = Api(prefs, mode = status.mode)
            runCatching { AlarmScheduler.schedule(context, status) }
            if (context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED &&
                android.os.Build.VERSION.SDK_INT >= 33) return
            val nm = context.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Reminders", NotificationManager.IMPORTANCE_DEFAULT))
            val open = PendingIntent.getActivity(
                context, 0, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            for (n in status.notifications.filter { !it.seen }) {
                val note = NotificationCompat.Builder(context, CHANNEL)
                    .setSmallIcon(R.drawable.ic_notify)
                    .setContentTitle(n.title)
                    .setContentText(n.body ?: "")
                    .setContentIntent(open)
                    .setAutoCancel(true)
                    .build()
                runCatching { NotificationManagerCompat.from(context).notify(n.id.hashCode(), note) }
                runCatching { api.post("/api/notifications/${n.id}/seen") }
            }
        }
    }
}
