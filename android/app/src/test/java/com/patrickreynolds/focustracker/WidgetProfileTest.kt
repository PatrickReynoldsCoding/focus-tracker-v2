package com.patrickreynolds.focustracker

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** 0.5.0 (D51): every widget keeps its own profile; the Files widget ticks a to-do's items. */
class WidgetProfileTest {
    private fun noDefault(): String? = throw AssertionError("the server's default should not be asked for")

    @Test fun widgetsPlacedBeforeKeepTheProfileTheyUsedLast() {
        // Widgets 1 and 2 were placed before 0.5.0 (no profile stored); 3 already has one.
        val has = { id: Int -> id == 3 }
        assertEquals(mapOf(1 to "work", 2 to "work"), WidgetProfile.migrate(intArrayOf(1, 2, 3), has, "work", "personal", ::noDefault))
        // The app never said which profile it had open: the profile of the last saved status.
        assertEquals(mapOf(1 to "personal"), WidgetProfile.migrate(intArrayOf(1), { false }, "", "personal", ::noDefault))
        // Nothing saved either: the server's default (what 0.4.0 showed).
        assertEquals(mapOf(1 to "family"), WidgetProfile.migrate(intArrayOf(1), { false }, "", null) { "family" })
        // Cannot tell yet (offline): nothing stored, tried again on the next update.
        assertNull(WidgetProfile.migrate(intArrayOf(1), { false }, "", "") { null })
        // Every widget has a profile (or none is placed): nothing to do, the server is not asked.
        assertEquals(emptyMap<Int, String>(), WidgetProfile.migrate(intArrayOf(3), has, "", null, ::noDefault))
        assertEquals(emptyMap<Int, String>(), WidgetProfile.migrate(intArrayOf(), has, "", null, ::noDefault))
    }

    @Test fun aWidgetsProfileIsKeptInItsSettings() {
        val today = WidgetConfig(mode = "work")
        assertEquals("work", WidgetProfile.of(WidgetConfig.parse(JSONObject(today.toJson().toString()))))
        assertNull(WidgetProfile.of(null))
        assertNull(WidgetProfile.of(WidgetConfig(mode = "")))
    }

    @Test fun eachProfileIsFetchedOnce() {
        val cfgs = mapOf(1 to WidgetConfig(mode = "work"), 2 to WidgetConfig(mode = "personal"), 3 to WidgetConfig(mode = "work"))
        assertEquals(mapOf("work" to listOf(1, 3), "personal" to listOf(2)), WidgetProfile.byProfile(intArrayOf(1, 2, 3, 4)) { cfgs[it] })
    }

    @Test fun requestsCarryTheWidgetsProfileNotTheApps() {
        assertEquals(mapOf("Authorization" to "Bearer tok", "X-Mode" to "work"), Api.headers("tok", WidgetProfile.of(WidgetConfig(mode = "work"))))
        // No profile: no X-Mode (the server's default); quick add and notifications only, never a widget.
        assertEquals(mapOf("Authorization" to "Bearer tok"), Api.headers("tok", null))
        assertEquals(mapOf("Authorization" to "Bearer tok"), Api.headers("tok", ""))
        assertEquals("/api/status?client=android", TodayWidget.STATUS_PATH)
    }

    @Test fun aDeletedProfileIsSaidNotHidden() {
        assertTrue(WidgetProfile.isRemoved(ApiException(400, "No profile \"gone\" (it may have been deleted)", "unknown_mode")))
        assertFalse(WidgetProfile.isRemoved(ApiException(404, "Not found", "not_found")))
        assertFalse(WidgetProfile.isRemoved(java.io.IOException()))
        assertFalse(WidgetProfile.isRemoved(null))
        assertEquals("Profile removed: tap to choose", WidgetProfile.REMOVED)
    }

    @Test fun aTickOnTheFilesWidget() {
        val t = WidgetTap.Tick(42, "l1", "c 1")
        val extras = t.extras()
        assertEquals("tick", extras[WidgetTap.EXTRA_TAP])
        assertEquals(t, WidgetTap.Tick.from { extras[it] })
        // An open-the-file tap is not a tick.
        assertNull(WidgetTap.Tick.from { mapOf(MainActivity.EXTRA_FRAGMENT to "/n/l1")[it] })
        assertNull(WidgetTap.Tick.from { (extras - WidgetTap.EXTRA_ITEM)[it] })
        assertNull(WidgetTap.Tick.from { (extras + (WidgetTap.EXTRA_WIDGET to "x"))[it] })
        // The endpoint the Single file widget uses.
        assertEquals("/api/todos/c%201/tick", WidgetTap.tickPath("c 1"))
        assertEquals("""{"done":true}""", WidgetTap.tickBody().toString())
    }

    @Test fun theTickShowsAtOnce() {
        val feed = """{"files":[{"kind":"list","id":"l2","title":"Shop","text":"• Milk","items":[{"id":"c1","title":"Milk","done":false}]},
            {"kind":"todo","id":"l1","title":"Jobs","text":"☐ Sand","items":[{"id":"c1","title":"Sand","done":false},{"id":"c2","title":"Paint","done":false}]}]}"""
        val after = FilesFeed.parse(JSONObject(WidgetTap.markDone(feed, "l1", "c1")!!))
        assertEquals(listOf(true, false), after.files[1].items!!.map { it.done })
        assertEquals(listOf(false), after.files[0].items!!.map { it.done }) // a plain list is never ticked
        assertNull(WidgetTap.markDone(feed, "l1", "missing"))
        assertNull(WidgetTap.markDone("not json", "l1", "c1"))
    }

    @Test fun everyWidgetHasSettingsAndTheFilesCardHasTicks() {
        val res = listOf(File("src/main/res"), File("app/src/main/res")).first { it.isDirectory }
        for (f in File(res, "xml").listFiles { f -> f.name.endsWith("_widget_info.xml") }!!) {
            val x = f.readText()
            assertTrue("${f.name} configure", x.contains("android:configure=\"com.patrickreynolds.focustracker.WidgetSetupActivity\""))
            assertTrue("${f.name} reconfigurable", x.contains("reconfigurable"))
        }
        for (name in listOf("widget_today.xml", "widget_today_narrow.xml")) assertTrue(name, File(res, "layout/$name").readText().contains("id/settings\""))
        assertTrue(File(res, "layout/widget_file_row.xml").readText().contains("id/items\""))
        val tick = File(res, "layout/widget_file_tick.xml").readText()
        for (id in listOf("tick", "mark", "label")) assertTrue(id, tick.contains("id/$id\""))
    }
}
