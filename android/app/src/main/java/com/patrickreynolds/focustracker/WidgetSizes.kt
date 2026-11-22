package com.patrickreynolds.focustracker

/**
 * How a widget draws at a width (dp, AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH: the portrait width).
 * Every widget can be 2 cells wide: about 110-200 dp depending on the launcher's grid.
 */
object WidgetSizes {
    enum class Width { NARROW, COMPACT, WIDE }

    /** Below this: 2 cells on most launchers. The narrow layouts stack the session row and use smaller text. */
    const val NARROW_BELOW = 200
    /** Below this: about 3 cells (as in 0.3.5). Smaller padding and text, side by side as usual. */
    const val COMPACT_BELOW = 230

    fun widthOf(dp: Int): Width = when {
        dp <= 0 -> Width.WIDE // not told yet: the launcher sends the size in a moment
        dp < NARROW_BELOW -> Width.NARROW
        dp < COMPACT_BELOW -> Width.COMPACT
        else -> Width.WIDE
    }
}
