package com.patrickreynolds.focustracker

import org.json.JSONArray
import org.json.JSONObject

/** An APK published on GitHub, as the updater needs to know it. */
data class Release(
    /** From the APK's file name: focus-tracker-0.3.0.apk is 0.3.0. */
    val version: String,
    /** From a "versionCode: 3" line in the release notes; null if the notes have none. */
    val versionCode: Int?,
    /** The release notes without the versionCode line. */
    val notes: String,
    val apkUrl: String,
    val apkName: String,
    val size: Long,
)

/** Pure parts of the update check (no Android classes), so they are unit tested. */
object UpdateCheck {
    private val APK_NAME = Regex("""^focus-tracker-(\d+(?:\.\d+)*)\.apk$""")
    private val CODE_LINE = Regex("""(?im)^[ \t]*version[ _-]?code[ \t]*[:=][ \t]*(\d+)[ \t]*$""")

    /**
     * The newest release that carries a focus-tracker-X.Y.Z.apk asset, out of GitHub's list of releases
     * (GET /repos/<owner>/<repo>/releases). Drafts and pre-releases are skipped, and so are releases with
     * no APK: most releases of this repository change only the web app. The version comes from the file
     * name, not the tag, because the tag is the whole project's version and the app's is its own.
     */
    fun newestRelease(json: String): Release? {
        val list = JSONArray(json)
        var best: Release? = null
        for (i in 0 until list.length()) {
            val o = list.getJSONObject(i)
            if (o.optBoolean("draft") || o.optBoolean("prerelease")) continue
            val r = releaseFrom(o) ?: continue
            if (best == null || isNewer(r.version, best.version)) best = r
        }
        return best
    }

    private fun releaseFrom(o: JSONObject): Release? {
        val assets = o.optJSONArray("assets") ?: return null
        for (i in 0 until assets.length()) {
            val a = assets.getJSONObject(i)
            val name = a.optString("name")
            val m = APK_NAME.matchEntire(name) ?: continue
            val body = o.optString("body", "")
            return Release(
                version = m.groupValues[1],
                versionCode = CODE_LINE.find(body)?.groupValues?.get(1)?.toIntOrNull(),
                notes = body.replace(CODE_LINE, "").trim(),
                apkUrl = a.getString("browser_download_url"),
                apkName = name,
                size = a.optLong("size", -1),
            )
        }
        return null
    }

    /** Is this release newer than the installed app? The version code in the notes decides when there is one; otherwise the version name. */
    fun isNewerThanInstalled(r: Release, installedCode: Long, installedName: String): Boolean =
        if (r.versionCode != null) r.versionCode > installedCode else isNewer(r.version, installedName)

    /** "0.10.0" is newer than "0.9.2": compared number by number; anything after a '-' is ignored. */
    fun isNewer(candidate: String, current: String): Boolean {
        fun parts(v: String) = v.substringBefore('-').split('.').map { it.trim().toIntOrNull() ?: 0 }
        val a = parts(candidate)
        val b = parts(current)
        for (i in 0 until maxOf(a.size, b.size)) {
            val x = a.getOrElse(i) { 0 }
            val y = b.getOrElse(i) { 0 }
            if (x != y) return x > y
        }
        return false
    }

    /** Where a release APK may come from (not enforced in debug builds, which test against a local server). */
    const val OFFICIAL_DOWNLOADS = "https://github.com/PatrickReynoldsCoding/focus-tracker-v2/releases/download/"
}
