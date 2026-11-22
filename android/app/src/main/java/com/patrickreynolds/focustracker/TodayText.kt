package com.patrickreynolds.focustracker

import org.json.JSONException

/** The Today widget's words that do not need Android, so the unit tests can check them. */
object TodayText {
    /** The note under the title when the server did not give a usable answer and the saved status is drawn instead. */
    fun failure(e: Throwable, savedAt: String): String = when (e) {
        is ApiException -> "${e.message} · saved $savedAt"
        is JSONException -> "Could not read the server’s answer · saved $savedAt"
        else -> "Offline · saved $savedAt"
    }

    /** The message when nothing was ever saved (the list area says this, not "Nothing left"). */
    fun noList(e: Throwable): String = when (e) {
        is ApiException -> e.message ?: "The tracker refused"
        is JSONException -> "Could not read the server’s answer"
        is IllegalStateException -> e.message ?: "Open the app to connect"
        else -> "Cannot reach the tracker"
    }

    fun mark(kind: String): String = if (kind == "habit") "+" else "☐"

    /** The broadcast a tap on an item sends (TodayWidget.onReceive). */
    fun tickAction(kind: String): String = when (kind) {
        "habit" -> "habit"
        "card" -> "card"
        else -> "todo"
    }
}
