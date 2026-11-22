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
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/** Every 15 minutes (session alerts have their own exact alarm, see AlarmScheduler): redraw the widgets (Today, Files, Single file) and show new reminders as notifications (each once). */
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
