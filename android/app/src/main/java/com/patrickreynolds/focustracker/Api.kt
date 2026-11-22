package com.patrickreynolds.focustracker

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Where the tracker is and how to talk to it. Kept in private app storage. */
class Prefs(context: Context) {
    private val p = context.getSharedPreferences("focus-tracker", Context.MODE_PRIVATE)
    var url: String
        get() = p.getString("url", "") ?: ""
        set(v) = p.edit().putString("url", v.trimEnd('/')).apply()
    var token: String
        get() = p.getString("token", "") ?: ""
        set(v) = p.edit().putString("token", v).apply()
    var mode: String
        get() = p.getString("mode", "personal") ?: "personal"
        set(v) = p.edit().putString("mode", v).apply()
    val ready get() = url.isNotEmpty() && token.isNotEmpty()

    /** The profile open in this phone's app ("" = not known yet): quick add and notifications use it (TodayProfile). Widgets have their own (WidgetProfile). */
    var appProfile: String
        get() = p.getString("app_profile", "") ?: ""
        set(v) = p.edit().putString("app_profile", v).apply()

    /** Profile labels (id → label as JSON) from GET /api/profiles, for the widget's "Nothing left today in Work". */
    var profileLabels: String
        get() = p.getString("profile_labels", "") ?: ""
        set(v) = p.edit().putString("profile_labels", v).apply()

    /** Set once 0.5.0 gave the Today widgets placed before it a profile of their own (WidgetProfile.migrate). */
    var todayWidgetsMigrated: Boolean
        get() = p.getBoolean("today_widgets_migrated", false)
        set(v) = p.edit().putBoolean("today_widgets_migrated", v).apply()

    /** The last status the server sent and when, so a widget can draw something while the server is slow or out of reach. */
    var cachedStatus: String
        get() = p.getString("status", "") ?: ""
        set(v) = p.edit().putString("status", v).apply()
    var cachedAt: Long
        get() = p.getLong("status_at", 0L)
        set(v) = p.edit().putLong("status_at", v).apply()
}

/** `code`: the server's error code (`unknown_mode`, `forbidden` ...), when it sent one. */
class ApiException(val status: Int, message: String, val code: String? = null) : Exception(message)

/**
 * Blocking HTTP calls: run them off the main thread. A widget's broadcast may run for about 10 seconds, so
 * `fast` gives up after 4 + 6 seconds and the widget shows the saved status instead of timing out.
 */
class Api(private val prefs: Prefs, private val fast: Boolean = false, private val mode: String? = null) {
    fun get(path: String): String = call("GET", path, null)
    fun post(path: String, body: JSONObject = JSONObject()): String = call("POST", path, body.toString())

    fun status(): Status {
        val text = get("/api/status?client=android")
        val status = Status.parse(JSONObject(text))
        prefs.cachedStatus = text
        prefs.cachedAt = System.currentTimeMillis()
        return status
    }

    private fun call(method: String, path: String, body: String?): String {
        val c = URL(prefs.url + path).openConnection() as HttpURLConnection
        c.requestMethod = method
        c.connectTimeout = if (fast) 4_000 else 10_000
        c.readTimeout = if (fast) 6_000 else 15_000
        headers(prefs.token, mode).forEach { (k, v) -> c.setRequestProperty(k, v) }
        if (body != null) {
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(body.toByteArray()) }
        }
        val code = c.responseCode
        val text = (if (code < 400) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
        if (code >= 400) {
            val err = runCatching { JSONObject(text) }.getOrNull()
            throw ApiException(code, err?.optString("error")?.ifEmpty { null } ?: "HTTP $code", err?.optString("code")?.ifEmpty { null })
        }
        return text
    }

    companion object {
        /** Every widget sends its own profile (WidgetProfile); quick add and notifications the app's (TodayProfile).
         *  No profile: no X-Mode, so the server's default answers. */
        fun headers(token: String, mode: String?): Map<String, String> =
            mapOf("Authorization" to "Bearer $token") + (if (mode.isNullOrEmpty()) emptyMap() else mapOf("X-Mode" to mode))

        /**
         * Sign in with the owner's password, make an API token for this phone, and
         * return (token, session cookie). The cookie also signs the WebView in.
         */
        fun connect(url: String, password: String, deviceName: String): Pair<String, String> {
            val base = url.trimEnd('/')
            val login = URL("$base/auth/login").openConnection() as HttpURLConnection
            login.requestMethod = "POST"
            login.doOutput = true
            login.setRequestProperty("Content-Type", "application/json")
            login.outputStream.use { it.write(JSONObject().put("password", password).toString().toByteArray()) }
            if (login.responseCode != 200) {
                val err = login.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
                throw ApiException(login.responseCode, runCatching { JSONObject(err).getString("error") }.getOrDefault("Could not sign in"))
            }
            val cookie = login.headerFields.entries.filter { it.key.equals("Set-Cookie", true) }.flatMap { it.value }
                .firstOrNull { it.startsWith("ft_session=") } ?: throw ApiException(500, "No session cookie")
            val pair = cookie.substringBefore(';')
            val t = URL("$base/api/tokens").openConnection() as HttpURLConnection
            t.requestMethod = "POST"
            t.doOutput = true
            t.setRequestProperty("Content-Type", "application/json")
            t.setRequestProperty("Cookie", pair)
            t.setRequestProperty("X-FT-Client", "android")
            t.outputStream.use { it.write(JSONObject().put("name", deviceName).toString().toByteArray()) }
            if (t.responseCode != 200) throw ApiException(t.responseCode, "Could not make a token")
            val token = JSONObject(t.inputStream.bufferedReader().use { it.readText() }).getString("token")
            return token to cookie
        }
    }
}
