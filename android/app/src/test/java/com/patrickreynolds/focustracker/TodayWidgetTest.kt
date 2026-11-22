package com.patrickreynolds.focustracker

import org.json.JSONException
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** The 0.4.1 fix: "Nothing left today" with a full Today list in the app. */
class TodayWidgetTest {
    // GET /api/status as production answered on 2026-11-22: the server's default profile (last opened on any
    // device) was an empty Work, while the phone's app showed Personal with 2 to-dos and 6 habits left.
    private val workStatus = """{"mode":"work","day":"2026-11-22","focus":null,"session":null,"todos_due":[],"habits_left":[],
      "today_list":{"left":0,"done":0,"items":[]},"notifications":[]}"""
    private val personalStatus = """{"mode":"personal","day":"2026-11-22","focus":null,"session":null,
      "todos_due":[{"id":"t1","title":"Post parcel","day":"2026-11-22"},{"id":"t2","title":"Ring bank","day":"2026-11-20"}],
      "habits_left":[{"id":"h1","name":"Stretch","left":1,"per":"day"},{"id":"h2","name":"Piano","left":2,"per":"week"}],
      "today_list":{"left":5,"done":0,"items":[
        {"kind":"habit","id":"h1","title":"Stretch","progress":null,"late":null,"can_skip":false},
        {"kind":"habit","id":"h2","title":"Piano","progress":"0/2 wk","late":null,"can_skip":true},
        {"kind":"todo","id":"t2","title":"Ring bank","progress":null,"late":"2026-11-20","can_skip":true},
        {"kind":"todo","id":"t1","title":"Post parcel","progress":null,"late":null,"can_skip":true},
        {"kind":"card","id":"c1","title":"Paint door","progress":null,"late":null,"can_skip":true}]},
      "notifications":[]}"""

    @Test fun theWidgetAsksForTheProfileOpenInTheApp() {
        // Before 0.4.1 no profile was sent, so the server's default (Work, empty) answered.
        assertEquals(0, Status.parse(JSONObject(workStatus)).items.size)
        val asked = mutableListOf<String?>()
        val s = TodayProfile.runIn("personal", {}) { mode -> asked += mode; Status.parse(JSONObject(if (mode == "personal") personalStatus else workStatus)) }
        assertEquals(listOf<String?>("personal"), asked)
        assertEquals(5, s.items.size)
        assertEquals("personal", s.mode)
    }

    @Test fun readsTheAppsProfileFromTheWebView() {
        assertEquals("work", TodayProfile.fromScript("\"work\""))
        assertEquals("personal", TodayProfile.fromScript("\"personal\""))
        assertNull(TodayProfile.fromScript("null"))
        assertNull(TodayProfile.fromScript(""))
        assertNull(TodayProfile.fromScript(null))
    }

    @Test fun aDeletedProfileFallsBackToTheServersDefault() {
        var forgot = false
        val asked = mutableListOf<String?>()
        val r = TodayProfile.runIn("gone", { forgot = true }) { mode ->
            asked += mode
            if (mode != null) throw ApiException(400, "No profile \"gone\"", "unknown_mode")
            "default"
        }
        assertEquals("default", r)
        assertEquals(listOf("gone", null), asked)
        assertTrue(forgot)
        // Other errors are not retried.
        assertThrows(ApiException::class.java) { TodayProfile.runIn("work", {}) { throw ApiException(401, "Sign in", "unauthorized") } }
    }

    @Test fun listsTheTodayListWithKindsAndNotToday() {
        val s = Status.parse(JSONObject(personalStatus))
        assertEquals(listOf("habit:h1", "habit:h2", "todo:t2", "todo:t1", "card:c1"), s.items.map { "${it.kind}:${it.id}" })
        assertEquals(listOf(false, true, true, true, true), s.items.map { it.canSkip })
        assertEquals("0/2 wk", s.items[1].detail)
        assertEquals("From 2026-11-20", s.items[2].detail)
        assertNull(s.items[3].detail)
        assertEquals("card", TodayText.tickAction("card"))
        assertEquals("☐", TodayText.mark("card"))
        assertEquals("+", TodayText.mark("habit"))
    }

    @Test fun withoutTheTodayListItUsesTheToDosAndHabits() {
        // Flag today-panel off: today_list is null.
        val s = Status.parse(JSONObject(personalStatus.replace(Regex("\"today_list\":\\{.*]},", RegexOption.DOT_MATCHES_ALL), "\"today_list\":null,")))
        assertEquals(listOf("todo:t1", "todo:t2", "habit:h1", "habit:h2"), s.items.map { "${it.kind}:${it.id}" })
        assertEquals(listOf(true, true, false, true), s.items.map { it.canSkip })
    }

    @Test fun anAnswerThatIsNotAStatusIsAnErrorNotAnEmptyList() {
        assertThrows(JSONException::class.java) { Status.parse(JSONObject("""{"day":"2026-11-22","focus":null}""")) }
        assertThrows(JSONException::class.java) { Status.parse(JSONObject("""{"day":"d","todos_due":[{"title":"no id"}]}""")) }
        assertThrows(JSONException::class.java) { Status.parse(JSONObject("""{"day":"d","today_list":{"left":1}}""")) }
    }

    @Test fun saysWhyTheSavedCopyIsShown() {
        assertEquals("Offline · saved 10:42", TodayText.failure(java.net.SocketTimeoutException(), "10:42"))
        assertEquals("Sign in, or send an API token · saved 10:42", TodayText.failure(ApiException(401, "Sign in, or send an API token"), "10:42"))
        assertEquals("Could not read the server’s answer · saved 10:42", TodayText.failure(JSONException("x"), "10:42"))
        assertEquals("Cannot reach the tracker", TodayText.noList(java.io.IOException()))
    }

    @Test fun theEmptyListSaysWhichProfile() {
        val labels = TodayProfile.labels("""{"default":"work","profiles":[{"id":"personal","label":"Personal"},{"id":"work","label":"Work"}]}""")
        assertEquals(mapOf("personal" to "Personal", "work" to "Work"), labels)
        assertEquals("Nothing left today in Work", TodayProfile.emptyText("work", labels))
        assertEquals("Nothing left for today", TodayProfile.emptyText("work", mapOf("work" to "Work")))
        assertEquals("Nothing left for today", TodayProfile.emptyText(null, labels))
        assertEquals(emptyMap<String, String>(), TodayProfile.labels("not json"))
    }
}
