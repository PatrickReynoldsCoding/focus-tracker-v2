package com.patrickreynolds.focustracker

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder

/** What GET /api/widget/files and /api/widget/file/:kind/:id send (src/modules/widgets.ts). */
data class WidgetFile(
    val kind: String,
    val id: String,
    val title: String,
    val project: String?,
    val route: String?,
    val url: String?,
    val text: String,
    val items: List<Item>?,
    val more: Boolean,
) {
    data class Item(val id: String, val title: String, val done: Boolean)

    companion object {
        private fun JSONObject.str(k: String): String? = if (!has(k) || isNull(k)) null else getString(k).ifEmpty { null }

        fun parse(o: JSONObject) = WidgetFile(
            kind = o.getString("kind"),
            id = o.getString("id"),
            title = o.optString("title"),
            project = o.str("project"),
            route = o.str("route"),
            url = o.str("url"),
            text = o.optString("text"),
            items = o.optJSONArray("items")?.let { a ->
                (0 until a.length()).map { a.getJSONObject(it) }.map { Item(it.getString("id"), it.optString("title"), it.optBoolean("done")) }
            },
            more = o.optBoolean("more"),
        )
    }
}

data class FilesFeed(val sourceName: String?, val sourceId: String?, val missing: Boolean, val files: List<WidgetFile>, val more: Boolean) {
    companion object {
        fun parse(o: JSONObject): FilesFeed {
            val src = o.optJSONObject("source")
            val files = o.optJSONArray("files") ?: JSONArray()
            return FilesFeed(
                sourceName = src?.optString("name")?.ifEmpty { null },
                sourceId = src?.optString("id")?.ifEmpty { null },
                missing = o.optBoolean("missing"),
                files = (0 until files.length()).map { WidgetFile.parse(files.getJSONObject(it)) },
                more = o.optBoolean("more"),
            )
        }
    }
}

/**
 * One widget's settings (a Today widget uses only `mode`, its profile). One Files or Single file widget's settings (chosen in WidgetSetupActivity). `source` is "all",
 * "folder" (sourceId a folder id, or "root") or "tag" (sourceId a tag id). The length is `max`
 * characters or `max` lines (`unit`).
 */
data class WidgetConfig(
    val mode: String,
    val source: String = "all",
    val sourceId: String = "",
    val sourceName: String = "",
    val deep: Boolean = true,
    val others: Boolean = false,
    val unit: String = UNIT_CHARS,
    val max: Int = 200,
    val sort: String = "changed",
    /** Single file widget: the file. */
    val fileKind: String = "",
    val fileId: String = "",
    val fileTitle: String = "",
) {
    fun toJson(): JSONObject = JSONObject()
        .put("mode", mode).put("source", source).put("sourceId", sourceId).put("sourceName", sourceName)
        .put("deep", deep).put("others", others).put("unit", unit).put("max", max).put("sort", sort)
        .put("fileKind", fileKind).put("fileId", fileId).put("fileTitle", fileTitle)

    private fun lengthQuery(charCap: Int): String = if (unit == UNIT_LINES) "lines=$max&max=$charCap" else "max=$max"

    /** The Files widget's request. */
    fun filesPath(limit: Int = 30): String {
        val q = mutableListOf("limit=$limit", lengthQuery(FILES_CHARS.last), "sort=$sort")
        if (others) q += "kinds=default,others"
        when (source) {
            "folder" -> { q += "folder=${enc(sourceId)}"; if (!deep) q += "deep=0" }
            "tag" -> q += "tag=${enc(sourceId)}"
        }
        return "/api/widget/files?" + q.joinToString("&")
    }

    /** The Single file widget's request. */
    fun filePath(): String = "/api/widget/file/${enc(fileKind)}/${enc(fileId)}?" + lengthQuery(FILE_CHARS.last)

    /** Where the header opens the app (a fragment of the web app). */
    fun sourceRoute(): String = when (source) {
        "folder" -> if (sourceId == "root" || sourceId.isEmpty()) "/files" else "/files/$sourceId"
        "tag" -> "/files?tag=${enc(sourceId)}"
        else -> "/files"
    }

    companion object {
        const val UNIT_CHARS = "chars"
        const val UNIT_LINES = "lines"
        /** The lengths the settings screen offers (the server caps them too: src/modules/widgets.ts CAPS).
         *  With a length in lines, characters are still capped at the top of the characters range. */
        val FILES_CHARS = 20..1000
        val FILES_LINES = 1..30
        val FILE_CHARS = 100..4000
        val FILE_LINES = 1..100

        private fun enc(s: String) = URLEncoder.encode(s, "UTF-8").replace("+", "%20")

        fun parse(o: JSONObject) = WidgetConfig(
            mode = o.optString("mode"),
            source = o.optString("source", "all"),
            sourceId = o.optString("sourceId"),
            sourceName = o.optString("sourceName"),
            deep = o.optBoolean("deep", true),
            others = o.optBoolean("others", false),
            unit = o.optString("unit", UNIT_CHARS),
            max = o.optInt("max", 200),
            sort = o.optString("sort", "changed"),
            fileKind = o.optString("fileKind"),
            fileId = o.optString("fileId"),
            fileTitle = o.optString("fileTitle"),
        )
    }
}

/** Each widget's settings and its last answer, kept in private app storage by widget id. */
class WidgetStore(context: Context) {
    private val p = context.getSharedPreferences("widgets", Context.MODE_PRIVATE)

    fun config(id: Int): WidgetConfig? = p.getString("cfg.$id", null)?.let { runCatching { WidgetConfig.parse(JSONObject(it)) }.getOrNull() }
    fun setConfig(id: Int, c: WidgetConfig) = p.edit().putString("cfg.$id", c.toJson().toString()).remove("data.$id").apply()

    fun saved(id: Int): String? = p.getString("data.$id", null)
    fun savedAt(id: Int): Long = p.getLong("at.$id", 0L)
    fun save(id: Int, json: String, at: Long = System.currentTimeMillis()) = p.edit().putString("data.$id", json).putLong("at.$id", at).apply()

    /** The habit category headings folded on this widget (Today widget). */
    fun folded(id: Int): Set<String> = p.getStringSet("fold.$id", emptySet()).orEmpty().toSet()
    fun toggleFold(id: Int, groupId: String) {
        val now = folded(id)
        p.edit().putStringSet("fold.$id", if (groupId in now) now - groupId else now + groupId).apply()
    }

    fun forget(id: Int) = p.edit().remove("cfg.$id").remove("data.$id").remove("at.$id").remove("fold.$id").apply()
}
