package com.patrickreynolds.focustracker

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AlarmPlanTest {
    private val now = 1_000_000L
    private fun session(
        phase: String? = "work", left: Long? = 600, paused: Boolean = false, waiting: String? = null,
        plannedLeft: Long? = null, timeUp: Boolean = false,
    ) = Status.Session("N", 10, phase, left, paused, waiting, plannedLeft, timeUp)

    @Test fun noSessionMeansNoAlarm() = assertNull(AlarmPlan.nextAlarmAt(null, now))

    @Test fun pausedMeansNoAlarm() = assertNull(AlarmPlan.nextAlarmAt(session(paused = true, plannedLeft = 60), now))

    @Test fun pomodoroEndsAtSecondsLeftPlusSlack() =
        assertEquals(now + 600_000 + AlarmPlan.SLACK_MS, AlarmPlan.nextAlarmAt(session(), now))

    @Test fun waitingPomodoroIsAlreadyNotified() = assertNull(AlarmPlan.nextAlarmAt(session(waiting = "break"), now))

    @Test fun plannedTimeAloneSetsAnAlarm() =
        assertEquals(now + 1_800_000 + AlarmPlan.SLACK_MS, AlarmPlan.nextAlarmAt(session(phase = null, left = null, plannedLeft = 1800), now))

    @Test fun earlierOfPomodoroAndPlannedWins() {
        assertEquals(now + 120_000 + AlarmPlan.SLACK_MS, AlarmPlan.nextAlarmAt(session(left = 600, plannedLeft = 120), now))
        assertEquals(now + 600_000 + AlarmPlan.SLACK_MS, AlarmPlan.nextAlarmAt(session(left = 600, plannedLeft = 3000), now))
    }

    @Test fun plannedAlreadyUpIsIgnoredButPomodoroStillCounts() =
        assertEquals(now + 300_000 + AlarmPlan.SLACK_MS, AlarmPlan.nextAlarmAt(session(left = 300, plannedLeft = 0, timeUp = true), now))

    @Test fun nothingToWaitFor() = assertNull(AlarmPlan.nextAlarmAt(session(phase = null, left = null), now))

    @Test fun methodFallsBackToAlarmClockWithoutPermission() {
        assertEquals(AlarmPlan.Method.EXACT, AlarmPlan.method(30, false)) // Android 11: always allowed
        assertEquals(AlarmPlan.Method.EXACT, AlarmPlan.method(34, true))
        assertEquals(AlarmPlan.Method.ALARM_CLOCK, AlarmPlan.method(34, false))
        assertEquals(AlarmPlan.Method.ALARM_CLOCK, AlarmPlan.method(31, false))
    }

    @Test fun readsPlannedFromTheServersStatus() {
        val s = Status.parse(JSONObject("""{"day":"d","focus":null,"todos_due":[],"habits_left":[],"notifications":[],
          "session":{"project_name":"N","elapsed_seconds":60,"pomodoro":{"phase":"work","seconds_left":90,"waiting":false},
          "planned":{"minutes":25,"seconds_left":1440,"time_up":false}}}"""))
        assertEquals(now + 90_000 + AlarmPlan.SLACK_MS, AlarmPlan.nextAlarmAt(s.session, now))
        assertEquals(1440L, s.session!!.plannedSecondsLeft)
    }
}
