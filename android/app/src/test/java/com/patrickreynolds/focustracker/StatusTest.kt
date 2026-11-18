package com.patrickreynolds.focustracker

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class StatusTest {
    @Test fun parsesTheServersStatus() {
        // Shape of GET /api/status (src/modules/today.ts, status()).
        val json = """{"mode":"personal","day":"2026-11-18","now":"x",
          "focus":{"id":"p1","name":"Novel","next_action":"scene 3","show_next_action":true},
          "session":{"project_id":"p1","project_name":"Novel","started":"x","elapsed_seconds":125,"pomodoro":{"phase":"work","seconds_left":600}},
          "todos_due":[{"id":"t1","title":"Milk","day":"2026-11-18"}],
          "habits_left":[{"id":"h1","name":"Run","left":2,"per":"week"}],
          "notifications":[{"id":"n1","title":"Reminder","body":null,"seen_at":null}]}"""
        val s = Status.parse(JSONObject(json))
        assertEquals("Novel", s.focusName)
        assertEquals("scene 3", s.nextAction)
        assertEquals(125L, s.session!!.elapsedSeconds)
        assertEquals("work", s.session!!.pomodoroPhase)
        assertEquals("Milk", s.todos[0].title)
        assertEquals("2 left this week", s.habits[0].detail)
        assertNull(s.notifications[0].body)
        assertEquals(false, s.notifications[0].seen)
    }

    @Test fun hidesTheNextActionWhenTurnedOff() {
        val s = Status.parse(JSONObject("""{"day":"d","focus":{"id":"p","name":"N","next_action":"x","show_next_action":false},"session":null,"todos_due":[],"habits_left":[],"notifications":[]}"""))
        assertNull(s.nextAction)
        assertNull(s.session)
    }
}
