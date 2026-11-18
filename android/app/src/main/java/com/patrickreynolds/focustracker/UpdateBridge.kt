package com.patrickreynolds.focustracker

import android.app.Activity
import android.webkit.JavascriptInterface

/**
 * `window.FocusTrackerAndroid` in the web app, present only inside this app. The web app's Settings
 * (web/src/features/android-app/) uses it to show the app's version and a "Check for updates" button.
 * It can only ask for the same checked update path as the native bar: nothing here takes a URL or a file.
 */
class UpdateBridge(private val activity: Activity) {
    /** JSON: { version, versionCode, state, latest?, notes?, progress?, message?, lastCheck }. */
    @JavascriptInterface
    fun info(): String = Updater.describe(activity).toString()

    @JavascriptInterface
    fun check() = activity.runOnUiThread { Updater.check(activity) }

    /** Download and install the update that check() found. */
    @JavascriptInterface
    fun install() = activity.runOnUiThread {
        (Updater.state as? Updater.State.Available)?.let { Updater.downloadAndInstall(activity, it.release) }
            ?: (Updater.state as? Updater.State.Failed)?.release?.let { Updater.downloadAndInstall(activity, it) }
    }

    /** Open Android's "install unknown apps" page for this app. */
    @JavascriptInterface
    fun allowInstalls() = activity.runOnUiThread { activity.startActivity(Updater.permissionSettings(activity)) }

    companion object { const val NAME = "FocusTrackerAndroid" }
}
