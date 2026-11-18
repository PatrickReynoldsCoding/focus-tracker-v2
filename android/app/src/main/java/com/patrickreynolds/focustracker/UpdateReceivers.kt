package com.patrickreynolds.focustracker

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.util.Log

/** What Android's installer says about an update: a confirmation to show, or how it went. */
class UpdateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirm = (if (android.os.Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                               else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_INTENT)) ?: return
                context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            PackageInstaller.STATUS_SUCCESS -> Log.i("focus-tracker", "update: installed") // this process is about to be replaced
            else -> {
                val msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
                Log.w("focus-tracker", "update: install failed, status $status: $msg")
                Updater.installFailed(if (status == PackageInstaller.STATUS_FAILURE_ABORTED) "Update cancelled." else "Android did not install it: ${msg ?: status}")
            }
        }
    }

    companion object { const val ACTION = "com.patrickreynolds.focustracker.UPDATE_STATUS" }
}

/** Runs in the new version straight after an update from the app: a note to say so, to open the app again. */
class UpdatedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED || !Updater.takeUpdatedFlag(context)) return
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("updates", "App updates", NotificationManager.IMPORTANCE_DEFAULT))
        val open = PendingIntent.getActivity(
            context, 0, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE,
        )
        runCatching {
            nm.notify(
                3,
                android.app.Notification.Builder(context, "updates")
                    .setSmallIcon(R.drawable.ic_notify)
                    .setContentTitle("Focus Tracker updated to ${Updater.installedVersion(context)}")
                    .setContentText("Tap to open")
                    .setContentIntent(open)
                    .setAutoCancel(true)
                    .build(),
            )
        }
        // Today's widget is redrawn by Android for the new version; the refresh worker is kept by WorkManager.
    }
}
