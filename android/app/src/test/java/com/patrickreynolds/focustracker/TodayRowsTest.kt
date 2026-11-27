package com.patrickreynolds.focustracker

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** Habit category headings on the Today widget. */
class TodayRowsTest {
    private val status = """{"mode":"personal","day":"2026-11-27","todos_due":[],"habits_left":[],"notifications":[],
      "today_list":{"left":3,"done":0,"items":[
        {"kind":"habit","id":"run","title":"Run"},{"kind":"habit","id":"stretch","title":"Stretch"},{"kind":"todo","id":"t1","title":"Post parcel"}]},
      "habit_groups":[{"id":"health","label":"Health","habit_ids":["stretch"]},{"id":"none","label":"No category","habit_ids":["run"]}]}"""

    private fun rows(folded: Set<String> = emptySet()): List<String> {
        val s = Status.parse(JSONObject(status))
        return TodayRows.of(s.items, s.habitGroups, folded).map {
            when (it) {
                is TodayRows.Heading -> "${TodayRows.headingText(it)} (${TodayRows.headingCount(it)})"
                is TodayRows.Entry -> it.item.title
            }
        }
    }

    @Test fun putsHabitsUnderTheirCategoryInTheCategoriesOrder() {
        assertEquals(listOf("▾ Health (1 left)", "Stretch", "▾ No category (1 left)", "Run", "Post parcel"), rows())
    }

    @Test fun aFoldedGroupKeepsItsHeadingAndCount() {
        assertEquals(listOf("▸ Health (1 left)", "▾ No category (1 left)", "Run", "Post parcel"), rows(setOf("health")))
    }

    @Test fun withNoGroupsTheItemsAreAsTheyWere() {
        val s = Status.parse(JSONObject(status))
        assertEquals(s.items.map { TodayRows.Entry(it) }, TodayRows.of(s.items, emptyList(), setOf("health")))
    }

    @Test fun aHabitNoGroupNamesIsStillListed() {
        val s = Status.parse(JSONObject(status))
        val onlyHealth = TodayRows.of(s.items, s.habitGroups.take(1), setOf("health"))
        assertEquals(listOf("run", "t1"), onlyHealth.filterIsInstance<TodayRows.Entry>().map { it.item.id })
    }
}
