package com.patrickreynolds.focustracker

import org.json.JSONArray
import org.json.JSONObject

/**
 * Which profile the Today widget, quick add and notifications use: the one open in this phone's app.
 *
 * Until 0.4.0 they sent no profile, so the server used its default profile, which follows the profile last
 * opened on any device (`profiles.follow_open`). Opening Work on the computer then left the phone's widget on
 * Work while the phone's app still showed Personal: "Nothing left today" with a full Today list in the app.
 */
object TodayProfile {
    /** Read in the WebView: the web app keeps the open profile in localStorage `ft.mode`, Personal when unset (web/src/core/api.ts). */
    const val SCRIPT = "(function(){try{return localStorage.getItem('ft.mode')||'personal'}catch(e){return null}})()"

    /** The value evaluateJavascript hands back for SCRIPT (a JSON value: "\"work\"" or "null"), or null when there is none. */
    fun fromScript(result: String?): String? {
        if (result.isNullOrBlank()) return null
        val v = runCatching { JSONArray("[$result]").opt(0) }.getOrNull()
        return (v as? String)?.trim()?.takeIf { it.isNotEmpty() }
    }

    /** The X-Mode to send: the app's profile, or null (the server's default) when the app has not told us yet. */
    fun of(prefs: Prefs): String? = prefs.appProfile.ifEmpty { null }

    /** Run `call` in the app's profile; when the server says that profile is gone, forget it and use the server's default. */
    fun <T> run(prefs: Prefs, call: (mode: String?) -> T): T = runIn(of(prefs), { prefs.appProfile = "" }, call)

    fun <T> runIn(mode: String?, forget: () -> Unit, call: (mode: String?) -> T): T =
        try {
            call(mode)
        } catch (e: ApiException) {
            if (mode == null || e.code != "unknown_mode") throw e
            forget()
            call(null)
        }

    /** GET /api/profiles → id → label. */
    fun labels(json: String): Map<String, String> {
        val list = runCatching { JSONObject(json).optJSONArray("profiles") }.getOrNull() ?: return emptyMap()
        return (0 until list.length()).mapNotNull { list.optJSONObject(it) }
            .mapNotNull { o -> o.optString("id").ifEmpty { null }?.let { it to (o.optString("label").ifEmpty { it }) } }
            .toMap()
    }

    /** What the widget says when the list is empty: with several profiles, which one it is showing. */
    fun emptyText(mode: String?, labels: Map<String, String>): String =
        if (mode != null && labels.size > 1) "Nothing left today in ${labels[mode] ?: mode}" else "Nothing left for today"
}
