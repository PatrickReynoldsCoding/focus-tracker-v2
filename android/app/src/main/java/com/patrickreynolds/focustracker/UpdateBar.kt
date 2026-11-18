package com.patrickreynolds.focustracker

import android.app.Activity
import android.app.AlertDialog
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView

/**
 * A small bar above the web app that appears only when there is an update to act on: "Update to
 * 0.3.0", with the release notes, a download progress bar, and the "install unknown apps" step.
 * The web app's Settings shows the same state (UpdateBridge) and has the "Check for updates" button.
 */
class UpdateBar(private val activity: Activity) : LinearLayout(activity) {
    private val title = TextView(activity)
    private val sub = TextView(activity)
    private val progress = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal)
    private val buttons = LinearLayout(activity)
    private var dismissedFor: String? = null
    private val onChange = { render() }

    init {
        orientation = VERTICAL
        val p = dp(12)
        setPadding(p, dp(8), p, dp(8))
        setBackgroundColor(activity.getColor(R.color.surface))
        title.setTextColor(activity.getColor(R.color.fg))
        title.textSize = 16f
        title.setTypeface(title.typeface, android.graphics.Typeface.BOLD)
        sub.setTextColor(activity.getColor(R.color.muted))
        sub.textSize = 14f
        progress.max = 100
        buttons.orientation = HORIZONTAL
        addView(title)
        addView(sub)
        addView(progress, LayoutParams(LayoutParams.MATCH_PARENT, dp(8)).apply { topMargin = dp(6) })
        addView(buttons)
        visibility = GONE
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    fun start() {
        Updater.listen(onChange)
        render()
    }

    fun stop() = Updater.unlisten(onChange)

    private fun button(text: String, primary: Boolean, run: () -> Unit) {
        val b = Button(activity, null, 0, if (primary) android.R.style.Widget_Material_Button_Colored else android.R.style.Widget_Material_Button_Borderless)
        b.text = text
        b.isAllCaps = false
        b.setOnClickListener { run() }
        buttons.addView(b)
    }

    private fun showNotes(r: Release) {
        AlertDialog.Builder(activity)
            .setTitle("Focus Tracker ${r.version}")
            .setMessage(r.notes.ifBlank { "No release notes." })
            .setPositiveButton("Update") { _, _ -> Updater.downloadAndInstall(activity, r) }
            .setNegativeButton("Later", null)
            .show()
    }

    private fun render() {
        buttons.removeAllViews()
        progress.visibility = GONE
        sub.visibility = VISIBLE
        val s = Updater.state
        when (s) {
            is Updater.State.Available -> {
                if (dismissedFor == s.release.version) { visibility = GONE; return }
                title.text = "Update to ${s.release.version}"
                sub.text = "Your setup and widgets are kept."
                button("Update", true) { Updater.downloadAndInstall(activity, s.release) }
                button("Release notes", false) { showNotes(s.release) }
                button("Later", false) { dismissedFor = s.release.version; render() }
            }
            is Updater.State.Downloading -> {
                title.text = "Downloading ${s.release.version}… ${(s.progress * 100).toInt()}%"
                sub.visibility = GONE
                progress.visibility = VISIBLE
                progress.progress = (s.progress * 100).toInt()
            }
            is Updater.State.NeedsPermission -> {
                title.text = "Update to ${s.release.version}"
                sub.text = "Android needs your OK once: turn on \"Allow from this source\", then come back."
                button("Open the setting", true) { activity.startActivity(Updater.permissionSettings(activity)) }
            }
            is Updater.State.Installing -> {
                title.text = "Installing ${s.release.version}…"
                sub.text = "The app closes for a moment. Open it again afterwards."
            }
            is Updater.State.Failed -> {
                val r = s.release ?: run { visibility = GONE; return } // a failed check shows in Settings
                title.text = "Update to ${r.version} did not work"
                sub.text = s.message
                button("Try again", true) { Updater.downloadAndInstall(activity, r) }
            }
            else -> { visibility = GONE; return }
        }
        visibility = View.VISIBLE
    }
}
