package com.patrickreynolds.focustracker

/** When to wake the app for the next session alert. Pure, so it is unit-tested. */
object AlarmPlan {
    /** The server counts whole seconds; wake a moment late so the alert is already due when we ask. */
    const val SLACK_MS = 1500L

    /**
     * The wall-clock time (ms) of the next alert for [session], or null for none: no session, a paused
     * session (its clock stands still), or nothing left to wait for. A pomodoro period that already
     * ended (waiting for "Start break") and a planned time already up were notified earlier, so they
     * set no alarm. The earlier of the pomodoro end and the planned end wins.
     */
    fun nextAlarmAt(session: Status.Session?, nowMs: Long): Long? {
        if (session == null || session.paused) return null
        val pomodoro = session.pomodoroSecondsLeft
            ?.takeIf { session.pomodoroPhase != null && session.waitingFor == null }
        val planned = session.plannedSecondsLeft?.takeIf { !session.plannedTimeUp }
        val left = listOfNotNull(pomodoro, planned).minOrNull() ?: return null
        return nowMs + left.coerceAtLeast(0) * 1000 + SLACK_MS
    }

    /** How to set the alarm: exactly when Android allows it, otherwise as an alarm clock (needs no permission). */
    enum class Method { EXACT, ALARM_CLOCK }

    fun method(sdk: Int, canScheduleExact: Boolean): Method =
        if (sdk < 31 || canScheduleExact) Method.EXACT else Method.ALARM_CLOCK
}
