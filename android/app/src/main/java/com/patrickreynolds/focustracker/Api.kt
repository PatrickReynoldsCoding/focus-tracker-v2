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
}

class ApiException(val status: Int, message: String) : Exception(message)

/** Blocking HTTP calls: run them off the main thread. */
class Api(private val prefs: Prefs) {
    fun get(path: String): String = call("GET", path, null)
    fun post(path: String, body: JSONObject = JSONObject()): String = call("POST", path, body.toString())

    fun status(): Status = Status.parse(JSONObject(get("/api/status")))

    private fun call(method: String, path: String, body: String?): String {
        val c = URL(prefs.url + path).openConnection() as HttpURLConnection
        c.requestMethod = method
        c.connectTimeout = 10_000
        c.readTimeout = 15_000
        c.setRequestProperty("Authorization", "Bearer ${prefs.token}")
        c.setRequestProperty("X-Mode", prefs.mode)
        if (body != null) {
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(body.toByteArray()) }
        }
        val code = c.responseCode
        val text = (if (code < 400) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
        if (code >= 400) throw ApiException(code, runCatching { JSONObject(text).getString("error") }.getOrDefault("HTTP $code"))
        return text
    }

    companion object {
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
