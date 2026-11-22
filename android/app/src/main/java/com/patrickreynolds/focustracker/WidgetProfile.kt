package com.patrickreynolds.focustracker

/**
 * Each widget's own profile (0.5.0, D51). Every widget (Today, Files, Single file) keeps the profile chosen in its
 * settings (WidgetConfig.mode, WidgetStore) and never follows the app's open profile or the server's default.
 * Quick add and notifications still follow the app's open profile (TodayProfile).
 */
object WidgetProfile {
    /** What a widget says when its profile was deleted; a tap opens its settings. */
    const val REMOVED = "Profile removed: tap to choose"

    /** A Today widget with no profile yet (added in a way that skipped its settings). */
    const val CHOOSE = "Tap to choose a profile"

    /** The server answers `unknown_mode` (400) for a profile that no longer exists (src/api.ts). */
    fun isRemoved(e: Throwable?): Boolean = (e as? ApiException)?.code == "unknown_mode"

    /** The profile a widget sends as X-Mode: its own, or none when it has none yet (it then asks to be set up). */
    fun of(cfg: WidgetConfig?): String? = cfg?.mode?.ifEmpty { null }

    /** Widgets by their profile, so each profile is fetched once however many widgets show it. Widgets without one are left out. */
    fun byProfile(ids: IntArray, cfg: (Int) -> WidgetConfig?): Map<String, List<Int>> =
        ids.toList().mapNotNull { id -> of(cfg(id))?.let { it to id } }.groupBy({ it.first }, { it.second })

    /**
     * Today widgets placed before 0.5.0 have no profile stored. Once, on their first update, each gets the profile it
     * used last: the app's open profile (0.4.1), else the profile of the last saved status, else the server's default
     * (what 0.4.0 showed). Returns the profile for each such widget, or null when none can be worked out yet (try again).
     */
    fun migrate(ids: IntArray, hasProfile: (Int) -> Boolean, appProfile: String, savedMode: String?, serverDefault: () -> String?): Map<Int, String>? {
        val missing = ids.filterNot(hasProfile)
        if (missing.isEmpty()) return emptyMap()
        val profile = appProfile.ifEmpty { null } ?: savedMode?.ifEmpty { null } ?: serverDefault()?.ifEmpty { null } ?: return null
        return missing.associateWith { profile }
    }
}
