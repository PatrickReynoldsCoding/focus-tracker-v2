package com.patrickreynolds.focustracker

import org.json.JSONArray
import org.json.JSONObject

/** The compact status from GET /api/status. */
data class Status(
    val day: String,
    val focusId: String?,
    val focusName: String?,
    val nextAction: String?,
    val session: Session?,
    val todos: List<Item>,
    val habits: List<Item>,
    val notifications: List<Notice>,
) {
    data class Session(val projectName: String?, val elapsedSeconds: Long, val pomodoroPhase: String?, val pomodoroSecondsLeft: Long?)
    data class Item(val id: String, val title: String, val detail: String?)
    data class Notice(val id: String, val title: String, val body: String?, val seen: Boolean)

    companion object {
        private fun JSONObject.str(k: String): String? = if (isNull(k) || !has(k)) null else getString(k).ifEmpty { null }
        private fun JSONArray?.objects(): List<JSONObject> = if (this == null) emptyList() else (0 until length()).map { getJSONObject(it) }

        fun parse(o: JSONObject): Status {
            val focus = o.optJSONObject("focus")
            val s = o.optJSONObject("session")
            val pomo = s?.optJSONObject("pomodoro")
            return Status(
                day = o.getString("day"),
                focusId = focus?.str("id"),
                focusName = focus?.str("name"),
                nextAction = if (focus?.optBoolean("show_next_action") == true) focus.str("next_action") else null,
                session = s?.let { Session(it.str("project_name"), it.optLong("elapsed_seconds"), pomo?.str("phase"), pomo?.optLong("seconds_left")) },
                todos = o.optJSONArray("todos_due").objects().map { Item(it.getString("id"), it.getString("title"), it.str("day")) },
                habits = o.optJSONArray("habits_left").objects().map {
                    val per = if (it.str("per") == "week") "this week" else "today"
                    Item(it.getString("id"), it.getString("name"), "${it.optInt("left")} left $per")
                },
                notifications = o.optJSONArray("notifications").objects().map { Notice(it.getString("id"), it.getString("title"), it.str("body"), !it.isNull("seen_at")) },
            )
        }
    }
}
