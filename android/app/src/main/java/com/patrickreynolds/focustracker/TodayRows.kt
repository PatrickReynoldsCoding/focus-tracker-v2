package com.patrickreynolds.focustracker

/** The Today widget's rows: the items, with the habits under category headings that fold. */
object TodayRows {
    sealed interface Row
    /** `count`: the habits in the group still to do, shown folded or open. */
    data class Heading(val groupId: String, val label: String, val count: Int, val folded: Boolean) : Row
    data class Entry(val item: Status.Item) : Row

    private const val HABIT = "habit"

    /** With no groups the rows are the items as they are. The grouped habits stand where the first habit stood. */
    fun of(items: List<Status.Item>, groups: List<Status.HabitGroup>, folded: Set<String>): List<Row> {
        val habits = items.filter { it.kind == HABIT }
        if (groups.isEmpty() || habits.isEmpty()) return items.map(::Entry)
        val grouped = groups.flatMap { group ->
            val mine = habits.filter { it.id in group.habitIds }
            if (mine.isEmpty()) return@flatMap emptyList<Row>()
            val isFolded = group.id in folded
            listOf(Heading(group.id, group.label, mine.size, isFolded)) + if (isFolded) emptyList() else mine.map(::Entry)
        }
        // A habit the groups do not name is still listed, after them.
        val unnamed = habits.filter { habit -> groups.none { habit.id in it.habitIds } }.map(::Entry)
        val before = items.takeWhile { it.kind != HABIT }.map(::Entry)
        val after = items.drop(before.size).filter { it.kind != HABIT }.map(::Entry)
        return before + grouped + unnamed + after
    }

    fun headingText(h: Heading): String = "${if (h.folded) "▸" else "▾"} ${h.label}"

    fun headingCount(h: Heading): String = "${h.count} left"
}
