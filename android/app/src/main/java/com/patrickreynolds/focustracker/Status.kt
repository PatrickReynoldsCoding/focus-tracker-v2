package com.patrickreynolds.focustracker

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** The compact status from GET /api/status. */
data class Status(
    val day: String,
    val focusId: String?,
    val focusName: String?,
    val session: Session?,
    val todos: List<Item>,
    val habits: List<Item>,
    val notifications: List<Notice>,
    /** The profile the server answered for (its id). */
    val mode: String? = null,
    /** What the Today widget lists: the server's Today list (today_list: habits, to-dos and cards, without what was put
     *  off with Not today) when it sends one, else the to-dos due and the habits left (flag today-panel off). */
    val items: List<Item> = todos + habits,
) {
    data class Session(
        val projectName: String?,
        val elapsedSeconds: Long,
        val pomodoroPhase: String?,
        val pomodoroSecondsLeft: Long?,
        val paused: Boolean = false,
        /** The pomodoro period ended and waits for "Start break" / "Start work" (next_phase). */
        val waitingFor: String? = null,
        /** Planned length: seconds of work left, and whether "Time is up" is already due. Null = no limit. */
        val plannedSecondsLeft: Long? = null,
        val plannedTimeUp: Boolean = false,
    )
    /** `kind`: todo, card or habit; `canSkip`: the server says it can be put off with Not today (every row can since 0.4.2; the widget shows ✕ on all). */
    data class Item(val id: String, val title: String, val detail: String?, val kind: String = "todo", val canSkip: Boolean = true)
    data class Notice(val id: String, val title: String, val body: String?, val seen: Boolean)

    companion object {
        private fun JSONObject.str(k: String): String? = if (isNull(k) || !has(k)) null else getString(k).ifEmpty { null }
        private fun JSONArray?.objects(): List<JSONObject> = if (this == null) emptyList() else (0 until length()).map { getJSONObject(it) }

        /** Throws (never an empty list in silence) when the answer is not a status: no to-dos and no Today list. */
        fun parse(o: JSONObject): Status {
            if (o.optJSONArray("todos_due") == null && o.optJSONObject("today_list") == null) throw JSONException("No to-dos or Today list in the server's answer")
            val todayList = o.optJSONObject("today_list")?.let { l ->
                (l.optJSONArray("items") ?: throw JSONException("No items in the Today list")).objects().map {
                    val kind = it.getString("kind")
                    val detail = if (kind == "habit") it.str("progress") else it.str("late")?.let { d -> "From $d" }
                    Item(it.getString("id"), it.getString("title"), detail, kind, it.optBoolean("can_skip", true))
                }
            }
            val todos = o.optJSONArray("todos_due").objects().map { Item(it.getString("id"), it.getString("title"), null, "todo", true) }
            val habits = o.optJSONArray("habits_left").objects().map {
                val per = if (it.str("per") == "week") "this week" else "today"
                Item(it.getString("id"), it.getString("name"), "${it.optInt("left")} left $per", "habit", true)
            }
            val focus = o.optJSONObject("focus")
            val s = o.optJSONObject("session")
            val pomo = s?.optJSONObject("pomodoro")
            val planned = s?.optJSONObject("planned")
            return Status(
                day = o.getString("day"),
                focusId = focus?.str("id"),
                focusName = focus?.str("name"),
                session = s?.let {
                    Session(
                        it.str("project_name"), it.optLong("elapsed_seconds"), pomo?.str("phase"), pomo?.optLong("seconds_left"),
                        paused = it.optBoolean("paused"),
                        waitingFor = if (pomo?.optBoolean("waiting") == true) (pomo.str("next_phase") ?: "next") else null,
                        plannedSecondsLeft = planned?.optLong("seconds_left"),
                        plannedTimeUp = planned?.optBoolean("time_up") == true,
                    )
                },
                todos = todos,
                habits = habits,
                notifications = o.optJSONArray("notifications").objects().map { Notice(it.getString("id"), it.getString("title"), it.str("body"), !it.isNull("seen_at")) },
                mode = o.str("mode"),
                items = todayList ?: (todos + habits),
            )
        }
    }
}
