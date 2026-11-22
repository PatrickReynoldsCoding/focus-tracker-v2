package com.patrickreynolds.focustracker

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.Spinner
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import kotlin.concurrent.thread

/**
 * The settings of a widget: which profile (every widget keeps its own, D51; the Today widget asks only this), and for a
 * Files or Single file widget what it shows (a folder, a tag or
 * everything; or one file, found by search, folder or tag), how much of each file, and the order.
 * Android opens it when the widget is added; ⚙ on the widget (and a long press on Android 12+) opens it again.
 */
class WidgetSetupActivity : Activity() {
    private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID
    private var single = false
    private var today = false
    private lateinit var prefs: Prefs
    private var old: WidgetConfig? = null

    private data class Choice(val id: String, val label: String)

    private var profiles = listOf<Choice>()
    private var folders = listOf<Choice>()
    private var tags = listOf<Choice>()
    private var chosenFile: Triple<String, String, String>? = null // kind, id, title

    private lateinit var profile: Spinner
    private lateinit var source: RadioGroup
    private lateinit var folder: Spinner
    private lateinit var deep: CheckBox
    private lateinit var tag: Spinner
    private lateinit var others: CheckBox
    private lateinit var sort: RadioGroup
    private lateinit var look: Spinner
    private lateinit var search: EditText
    private lateinit var results: LinearLayout
    private lateinit var chosen: TextView
    private lateinit var unit: RadioGroup
    private lateinit var length: SeekBar
    private lateinit var lengthText: TextView
    private lateinit var status: TextView
    private lateinit var save: Button
    private var lookChoices = listOf<Choice>()
    private var searchRun = 0
    private var listsFor: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
        val info = AppWidgetManager.getInstance(this).getAppWidgetInfo(widgetId)
        if (info == null || info.provider.packageName != packageName) { finish(); return }
        single = info.provider.className == SingleFileWidget::class.java.name
        today = info.provider.className == TodayWidget::class.java.name
        prefs = Prefs(this)
        old = WidgetStore(this).config(widgetId)
        old?.takeIf { it.fileId.isNotEmpty() }?.let { chosenFile = Triple(it.fileKind, it.fileId, it.fileTitle) }
        build()
        if (!prefs.ready) {
            status.text = "Open the Focus app and connect first, then add the widget again."
            save.isEnabled = false
            return
        }
        loadProfiles()
    }

    // ---------- the screen ----------

    private fun dp(n: Int) = (n * resources.displayMetrics.density).toInt()
    private fun label(text: String, top: Int = 16) = TextView(this).apply {
        this.text = text
        setTextColor(getColor(R.color.muted))
        setPadding(0, dp(top), 0, dp(2))
    }
    private fun radio(group: RadioGroup, id: Int, text: String) = group.addView(RadioButton(this).apply { this.id = id; this.text = text; minHeight = dp(48) })
    private fun spinner() = Spinner(this).apply { minimumHeight = dp(48) }
    private fun setChoices(s: Spinner, items: List<Choice>, selectId: String?) {
        s.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, items.map { it.label })
        items.indexOfFirst { it.id == selectId }.takeIf { it >= 0 }?.let { s.setSelection(it) }
    }
    private fun Spinner.chosenId(items: List<Choice>): String? = items.getOrNull(selectedItemPosition)?.id
    private fun onPick(s: Spinner, run: () -> Unit) {
        s.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(p: AdapterView<*>?, v: View?, pos: Int, id: Long) = run()
            override fun onNothingSelected(p: AdapterView<*>?) = Unit
        }
    }

    private fun build() {
        val c = old
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(16), dp(20), dp(24)) }
        col.addView(TextView(this).apply {
            text = if (today) "Today widget" else if (single) "File widget" else "Files widget"
            textSize = 22f
            setTextColor(getColor(R.color.fg))
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        })
        col.addView(label(when {
            today -> "Shows today's focus, session and Today list of one profile. It keeps this profile whichever profile the app has open."
            single -> "Shows one note, list or to-do. Tap a to-do's item on the widget to tick it."
            else -> "Shows the notes, lists and to-dos of a folder or a tag, newest first, with the start of each. Tap a to-do's item to tick it."
        }, 4))

        col.addView(label("Profile"))
        profile = spinner().also { col.addView(it) }

        source = RadioGroup(this)
        folder = spinner()
        deep = CheckBox(this).apply { text = "Include the folders inside it"; minHeight = dp(48); isChecked = c?.deep ?: true }
        tag = spinner()
        others = CheckBox(this).apply { text = "Also show whiteboards and links (titles only)"; minHeight = dp(48); isChecked = c?.others ?: false }
        sort = RadioGroup(this)
        look = spinner()
        search = EditText(this).apply { hint = "Search by name or text"; minHeight = dp(48); isSingleLine = true; importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO }
        results = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        chosen = TextView(this).apply { setTextColor(getColor(R.color.fg)); setPadding(0, dp(8), 0, 0) }

        if (today) {
            // Only the profile.
        } else if (!single) {
            col.addView(label("Show"))
            radio(source, ID_ALL, "Every file of the profile")
            radio(source, ID_FOLDER, "A folder")
            radio(source, ID_TAG, "A tag")
            source.check(when (c?.source) { "folder" -> ID_FOLDER; "tag" -> ID_TAG; else -> ID_ALL })
            col.addView(source)
            col.addView(folder)
            col.addView(deep)
            col.addView(tag)
            col.addView(others)
            col.addView(label("Order"))
            radio(sort, ID_CHANGED, "Last changed first")
            radio(sort, ID_NAME, "By name")
            sort.check(if (c?.sort == "name") ID_NAME else ID_CHANGED)
            col.addView(sort)
            source.setOnCheckedChangeListener { _, _ -> showSource() }
        } else {
            col.addView(label("Find the file"))
            col.addView(look)
            col.addView(search)
            col.addView(chosen)
            col.addView(results)
            search.addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, d: Int) = Unit
                override fun onTextChanged(s: CharSequence?, a: Int, b: Int, d: Int) = Unit
                override fun afterTextChanged(s: Editable?) { search.removeCallbacks(searchLater); search.postDelayed(searchLater, 400) }
            })
            onPick(look) { findFiles() }
            showChosen()
        }

        if (!today) col.addView(label(if (single) "Length" else "Length of each file"))
        unit = RadioGroup(this).apply { orientation = RadioGroup.HORIZONTAL }
        radio(unit, ID_CHARS, "Characters")
        radio(unit, ID_LINES, "Lines")
        unit.check(if (c?.unit == WidgetConfig.UNIT_LINES) ID_LINES else ID_CHARS)
        lengthText = TextView(this).apply { setTextColor(getColor(R.color.fg)) }
        length = SeekBar(this).apply { minimumHeight = dp(48) }
        if (!today) {
            col.addView(unit)
            col.addView(lengthText)
            col.addView(length)
        }
        setLengthRange(c?.max ?: if (single) 1000 else 200)
        unit.setOnCheckedChangeListener { _, _ -> setLengthRange(null) }
        length.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(s: SeekBar?, p: Int, fromUser: Boolean) = showLength()
            override fun onStartTrackingTouch(s: SeekBar?) = Unit
            override fun onStopTrackingTouch(s: SeekBar?) = Unit
        })

        status = TextView(this).apply { setTextColor(getColor(R.color.muted)); setPadding(0, dp(12), 0, 0) }
        col.addView(status)
        save = Button(this).apply { text = if (old == null) "Add widget" else "Save"; minHeight = dp(52) }
        col.addView(save, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12) })
        save.setOnClickListener { finishSetup() }

        val scroll = ScrollView(this)
        scroll.addView(col)
        // Android 15 draws behind the system bars: keep the screen clear of them.
        scroll.setOnApplyWindowInsetsListener { v, insets ->
            val bars = insets.getInsets(android.view.WindowInsets.Type.systemBars() or android.view.WindowInsets.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        setContentView(scroll)
        onPick(profile) { loadLists() }
        showSource()
    }

    private fun showSource() {
        if (single || today) return
        val by = source.checkedRadioButtonId
        folder.visibility = if (by == ID_FOLDER) View.VISIBLE else View.GONE
        deep.visibility = folder.visibility
        tag.visibility = if (by == ID_TAG) View.VISIBLE else View.GONE
    }

    /** The length slider's range for the unit chosen (chars or lines); `value` to set, or keep the default. */
    private fun setLengthRange(value: Int?) {
        val r = range()
        length.max = (r.last - r.first) / step()
        val v = (value ?: if (unit.checkedRadioButtonId == ID_LINES) (if (single) 20 else 4) else (if (single) 1000 else 200)).coerceIn(r)
        length.progress = (v - r.first) / step()
        showLength()
    }
    private fun lines() = unit.checkedRadioButtonId == ID_LINES
    private fun range() = if (lines()) (if (single) WidgetConfig.FILE_LINES else WidgetConfig.FILES_LINES) else (if (single) WidgetConfig.FILE_CHARS else WidgetConfig.FILES_CHARS)
    private fun step() = if (lines()) 1 else 10
    private fun lengthValue() = (range().first + length.progress * step()).coerceIn(range())
    private fun showLength() {
        val n = lengthValue()
        lengthText.text = if (lines()) "$n ${if (n == 1) "line" else "lines"}" else "$n characters"
    }

    private fun showChosen() {
        chosen.text = chosenFile?.let { "Chosen: ${it.third}" } ?: "Choose a file below."
    }

    // ---------- loading ----------

    private fun loadProfiles() {
        status.text = "Loading…"
        thread {
            val r = runCatching { JSONObject(Api(prefs).get("/api/profiles")) }
            runOnUiThread {
                r.onFailure { status.text = "Cannot reach the tracker: ${it.message}" }
                r.onSuccess { o ->
                    val list = o.optJSONArray("profiles") ?: JSONArray()
                    profiles = (0 until list.length()).map { list.getJSONObject(it) }.map { Choice(it.getString("id"), it.optString("label", it.getString("id"))) }
                    val oldMode = old?.mode?.ifEmpty { null }
                    val ids = profiles.map { it.id }
                    // A new widget starts on the profile open in the app; it keeps the one chosen here from then on.
                    setChoices(profile, profiles, oldMode?.takeIf { it in ids } ?: prefs.appProfile.takeIf { it in ids } ?: o.optString("default"))
                    status.text = if (oldMode != null && oldMode !in ids) "The profile this widget showed was removed: choose another." else ""
                    loadLists()
                }
            }
        }
    }

    /** The profile's folders (with their paths) and tags. */
    private fun loadLists() {
        if (today) return
        val mode = profile.chosenId(profiles) ?: return
        if (mode == listsFor) return // the spinner reports its first choice too
        listsFor = mode
        thread {
            val r = runCatching {
                val api = Api(prefs, mode = mode)
                val f = JSONArray(api.get("/api/folders?limit=2000"))
                val t = runCatching { JSONArray(api.get("/api/tags")) }.getOrDefault(JSONArray()) // the tags flag may be off
                f to t
            }
            runOnUiThread {
                if (profile.chosenId(profiles) != mode) return@runOnUiThread
                r.onFailure { status.text = "Cannot load folders: ${it.message}"; listsFor = null }
                r.onSuccess { (f, t) ->
                    folders = listOf(Choice("root", "Top level (not in a folder)")) + folderPaths(f)
                    tags = (0 until t.length()).map { t.getJSONObject(it) }.map { Choice(it.getString("id"), "#" + it.getString("name")) }
                    val keep = old?.takeIf { it.mode == mode }
                    setChoices(folder, folders, keep?.sourceId?.takeIf { keep.source == "folder" })
                    setChoices(tag, tags.ifEmpty { listOf(Choice("", "No tags yet")) }, keep?.sourceId?.takeIf { keep.source == "tag" })
                    lookChoices = listOf(Choice("recent", "Recently changed")) + folders.map { Choice("folder:" + it.id, "Folder: " + it.label) } +
                        tags.map { Choice("tag:" + it.id, "Tag: " + it.label) }
                    if (single) setChoices(look, lookChoices, "recent")
                    if (single) findFiles()
                }
            }
        }
    }

    /** Folders as "Parent › Child", sorted by that path. */
    private fun folderPaths(a: JSONArray): List<Choice> {
        val rows = (0 until a.length()).map { a.getJSONObject(it) }
        val byId = rows.associateBy { it.getString("id") }
        fun path(o: JSONObject): String {
            val names = mutableListOf<String>()
            var at: JSONObject? = o
            var guard = 0
            while (at != null && guard++ < 50) {
                names.add(0, at.optString("name"))
                at = at.optString("parent_id").takeIf { it.isNotEmpty() && it != "null" }?.let { byId[it] }
            }
            return names.joinToString(" › ")
        }
        return rows.map { Choice(it.getString("id"), path(it)) }.sortedBy { it.label.lowercase() }
    }

    private val searchLater = Runnable { findFiles() }

    /** Single file: files to choose from: a search, or the recent files of a folder, a tag or the profile. */
    private fun findFiles() {
        val mode = profile.chosenId(profiles) ?: return
        val q = search.text.toString().trim()
        val where = look.chosenId(lookChoices) ?: "recent"
        val run = ++searchRun
        thread {
            val r = runCatching {
                val api = Api(prefs, mode = mode)
                if (q.isNotEmpty()) {
                    val o = JSONObject(api.get("/api/files?sort=changed&limit=50&q=" + URLEncoder.encode(q, "UTF-8")))
                    val a = o.optJSONArray("files") ?: JSONArray()
                    (0 until a.length()).map { a.getJSONObject(it) }.map { Triple(it.getString("type"), it.getString("id"), it.optString("name")) to it.optString("project_name") }
                } else {
                    val scope = when {
                        where.startsWith("folder:") -> "&folder=" + URLEncoder.encode(where.removePrefix("folder:"), "UTF-8")
                        where.startsWith("tag:") -> "&tag=" + URLEncoder.encode(where.removePrefix("tag:"), "UTF-8")
                        else -> ""
                    }
                    val feed = FilesFeed.parse(JSONObject(api.get("/api/widget/files?limit=50&max=1$scope")))
                    feed.files.map { Triple(it.kind, it.id, it.title) to (it.project ?: "") }
                }
            }
            runOnUiThread {
                if (run != searchRun) return@runOnUiThread
                results.removeAllViews()
                r.onFailure { status.text = "Cannot load files: ${it.message}" }
                r.onSuccess { found ->
                    val usable = found.filter { it.first.first in FILE_KINDS }
                    if (usable.isEmpty()) results.addView(label(if (q.isEmpty()) "No notes, lists or to-dos here." else "Nothing found.", 8))
                    for ((f, project) in usable) {
                        results.addView(TextView(this).apply {
                            text = f.third + "  ·  " + (KIND_LABELS[f.first] ?: f.first) + (if (project.isNotEmpty()) " · $project" else "")
                            setTextColor(getColor(R.color.fg))
                            textSize = 15f
                            minHeight = dp(48)
                            gravity = Gravity.CENTER_VERTICAL
                            setPadding(dp(4), 0, dp(4), 0)
                            setOnClickListener { chosenFile = f; showChosen() }
                        })
                    }
                }
            }
        }
    }

    // ---------- saving ----------

    private fun finishSetup() {
        val mode = profile.chosenId(profiles) ?: return
        val by = source.checkedRadioButtonId
        val cfg = if (today) {
            WidgetConfig(mode = mode)
        } else if (single) {
            val f = chosenFile ?: run { status.text = "Choose a file first."; return }
            WidgetConfig(mode = mode, unit = if (lines()) WidgetConfig.UNIT_LINES else WidgetConfig.UNIT_CHARS, max = lengthValue(), fileKind = f.first, fileId = f.second, fileTitle = f.third)
        } else {
            val src = when (by) { ID_FOLDER -> "folder"; ID_TAG -> "tag"; else -> "all" }
            val picked = when (src) { "folder" -> folders.getOrNull(folder.selectedItemPosition); "tag" -> tags.getOrNull(tag.selectedItemPosition); else -> null }
            if (src != "all" && picked == null) { status.text = if (src == "tag") "There are no tags in this profile yet." else "Choose a folder."; return }
            WidgetConfig(
                mode = mode, source = src, sourceId = picked?.id ?: "", sourceName = picked?.label?.removePrefix("#")?.substringAfterLast(" › ") ?: "All files",
                deep = deep.isChecked, others = others.isChecked, unit = if (lines()) WidgetConfig.UNIT_LINES else WidgetConfig.UNIT_CHARS, max = lengthValue(),
                sort = if (sort.checkedRadioButtonId == ID_NAME) "name" else "changed",
            )
        }
        WidgetStore(this).setConfig(widgetId, cfg)
        val app = applicationContext
        val id = widgetId
        thread {
            when {
                today -> TodayWidget.refresh(app, intArrayOf(id))
                single -> SingleFileWidget.refresh(app, intArrayOf(id))
                else -> FilesWidget.refresh(app, intArrayOf(id))
            }
        }
        setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
        finish()
    }

    companion object {
        private const val ID_ALL = 101
        private const val ID_FOLDER = 102
        private const val ID_TAG = 103
        private const val ID_CHANGED = 111
        private const val ID_NAME = 112
        private const val ID_CHARS = 121
        private const val ID_LINES = 122
        /** What the Single file widget can show. */
        private val FILE_KINDS = setOf("note", "list", "todo", "project-note")
        private val KIND_LABELS = mapOf("note" to "Note", "list" to "List", "todo" to "To-do", "project-note" to "Project notes")
    }
}
