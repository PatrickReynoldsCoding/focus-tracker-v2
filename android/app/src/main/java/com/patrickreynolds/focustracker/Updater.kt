package com.patrickreynolds.focustracker

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors

/**
 * Updates from inside the app, the way the owner's Steady app does them. The releases are APKs on
 * GitHub: ask GitHub for the releases, find the newest APK, download it with progress, check that it is
 * this app, newer, and signed with the same key, and hand it to Android's PackageInstaller. Android asks
 * to confirm (and, the first time, to allow this app to install apps). Settings, widgets and the
 * sign-in are kept: an update replaces the code, not the app's data.
 *
 * Release convention (see AGENTS.md and README.md): a GitHub release that has an asset named
 * focus-tracker-X.Y.Z.apk and, in its notes, a line "versionCode: N". Releases without an APK are ignored.
 *
 * Screens: UpdateBar (native bar in the app), UpdateBridge (so the web app's Settings can show it).
 */
object Updater {
    const val REPO = "PatrickReynoldsCoding/focus-tracker-v2"
    private const val TAG = "focus-tracker"
    /** Checked when the app opens, at most this often. */
    private const val CHECK_EVERY_MS = 4L * 60 * 60 * 1000

    sealed class State {
        object Idle : State()
        object Checking : State()
        data class UpToDate(val latest: String) : State()
        data class Available(val release: Release) : State()
        data class Downloading(val release: Release, val progress: Float) : State()
        /** Downloaded and checked; waiting for "install unknown apps" to be allowed for this app. */
        data class NeedsPermission(val release: Release, val apk: File) : State()
        data class Installing(val release: Release) : State()
        data class Failed(val message: String, val release: Release? = null) : State()
    }

    @Volatile var state: State = State.Idle
        private set
    @Volatile var lastCheckMs: Long = 0L
        private set

    private val listeners = CopyOnWriteArrayList<() -> Unit>()
    private lateinit var prefs: SharedPreferences
    private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "updater") }
    private val main = Handler(Looper.getMainLooper())

    /** Called on the main thread whenever the state changes. */
    fun listen(l: () -> Unit) { listeners.add(l) }
    fun unlisten(l: () -> Unit) { listeners.remove(l) }

    private fun set(s: State) {
        state = s
        main.post { listeners.forEach { it() } }
    }

    fun init(context: Context) {
        if (::prefs.isInitialized) return
        prefs = context.applicationContext.getSharedPreferences("updates", Context.MODE_PRIVATE)
        lastCheckMs = prefs.getLong("last", 0L)
    }

    private fun installed(context: Context): PackageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
    fun installedVersion(context: Context): String = installed(context).versionName ?: "?"
    fun installedCode(context: Context): Long = installed(context).longVersionCode
    private fun isDebug(context: Context) = context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0

    /** Debug builds only: where to look for releases instead of GitHub (a local test server). Empty clears it. */
    fun setTestUrl(context: Context, url: String?) {
        init(context)
        if (!isDebug(context)) return
        prefs.edit().apply { if (url.isNullOrEmpty()) remove("url") else putString("url", url) }.apply()
        set(State.Idle)
    }

    private fun releasesUrl(context: Context): String =
        (if (isDebug(context)) prefs.getString("url", null) else null) ?: "https://api.github.com/repos/$REPO/releases?per_page=30"

    /** On opening the app: check, if the last check was a few hours ago. */
    fun checkIfDue(context: Context) {
        init(context)
        // Android 11 restarts the app when "Install unknown apps" is switched on, so the update in
        // progress is forgotten. A flag survives that: check again and carry on installing.
        if (prefs.getBoolean("resume", false) && state == State.Idle) {
            prefs.edit().putBoolean("resume", false).apply()
            if (context.packageManager.canRequestPackageInstalls()) { check(context, thenInstall = true); return }
        }
        if (System.currentTimeMillis() - lastCheckMs > CHECK_EVERY_MS && state == State.Idle) check(context)
    }

    /** "Check for updates". */
    fun check(context: Context, thenInstall: Boolean = false) {
        init(context)
        val app = context.applicationContext
        if (state is State.Checking || state is State.Downloading || state is State.Installing) return
        set(State.Checking)
        worker.execute {
            try {
                val r = fetchLatest(app)
                val now = System.currentTimeMillis()
                lastCheckMs = now
                prefs.edit().putLong("last", now).apply()
                val available = r != null && UpdateCheck.isNewerThanInstalled(r, installedCode(app), installedVersion(app))
                set(if (available) State.Available(r!!) else State.UpToDate(installedVersion(app)))
                if (available && thenInstall) main.post { downloadAndInstall(app, r!!) }
            } catch (e: Exception) {
                Log.w(TAG, "update check failed", e)
                set(State.Failed("Could not check for updates: ${e.message ?: e.javaClass.simpleName}"))
            }
        }
    }

    private fun fetchLatest(context: Context): Release? {
        val c = URL(releasesUrl(context)).openConnection() as HttpURLConnection
        c.connectTimeout = 10_000
        c.readTimeout = 15_000
        c.setRequestProperty("Accept", "application/vnd.github+json")
        c.setRequestProperty("User-Agent", "focus-tracker-android/${installedVersion(context)}")
        try {
            if (c.responseCode == 404) return null // no releases yet
            if (c.responseCode != 200) throw IllegalStateException("GitHub answered ${c.responseCode}")
            val release = UpdateCheck.newestRelease(c.inputStream.bufferedReader().readText())
            // Release builds only install from this repository's releases.
            if (release != null && !isDebug(context) && !release.apkUrl.startsWith(UpdateCheck.OFFICIAL_DOWNLOADS))
                throw IllegalStateException("The release points somewhere else: ${release.apkUrl}")
            return release
        } finally { c.disconnect() }
    }

    fun downloadAndInstall(context: Context, r: Release) {
        val app = context.applicationContext
        init(app)
        if (state is State.Downloading || state is State.Installing) return
        set(State.Downloading(r, 0f))
        worker.execute {
            try {
                val dir = File(app.cacheDir, "updates").apply { mkdirs() }
                dir.listFiles()?.forEach { it.delete() } // an older download
                val apk = File(dir, r.apkName)
                download(app, r, apk)
                verify(app, apk)
                if (!app.packageManager.canRequestPackageInstalls()) { set(State.NeedsPermission(r, apk)); return@execute }
                install(app, r, apk)
            } catch (e: Exception) {
                Log.w(TAG, "update failed", e)
                set(State.Failed(e.message ?: e.javaClass.simpleName, r))
            }
        }
    }

    /** After "install unknown apps" was allowed in Android's settings. */
    fun continueInstall(context: Context) {
        val s = state as? State.NeedsPermission ?: return
        if (!context.packageManager.canRequestPackageInstalls()) return
        prefs.edit().putBoolean("resume", false).apply()
        set(State.Installing(s.release))
        worker.execute {
            try { install(context.applicationContext, s.release, s.apk) }
            catch (e: Exception) { set(State.Failed(e.message ?: e.javaClass.simpleName, s.release)) }
        }
    }

    /** Android's page where this app is allowed to install apps (its updates). */
    fun permissionSettings(context: Context): Intent {
        init(context)
        prefs.edit().putBoolean("resume", true).commit() // in case Android restarts the app (see checkIfDue)
        return Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
    }

    private fun download(context: Context, r: Release, to: File) {
        val c = URL(r.apkUrl).openConnection() as HttpURLConnection // follows GitHub's redirect to its file host
        c.connectTimeout = 15_000
        c.readTimeout = 30_000
        c.setRequestProperty("User-Agent", "focus-tracker-android/${installedVersion(context)}")
        try {
            if (c.responseCode != 200) throw IllegalStateException("Download failed: the server answered ${c.responseCode}")
            val total = c.contentLengthLong.takeIf { it > 0 } ?: r.size
            var got = 0L
            var shown = -1
            c.inputStream.use { input ->
                to.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        got += n
                        val pct = if (total > 0) (100 * got / total).toInt() else 0
                        if (pct != shown) { shown = pct; set(State.Downloading(r, pct / 100f)) }
                    }
                }
            }
            if (total > 0 && got != total) throw IllegalStateException("Download cut short ($got of $total bytes)")
        } finally { c.disconnect() }
    }

    /** It must be this app, newer than this one, and signed with the same key. */
    private fun verify(context: Context, apk: File) {
        val pm = context.packageManager
        val flags = PackageManager.GET_SIGNING_CERTIFICATES
        val new = pm.getPackageArchiveInfo(apk.path, flags) ?: throw IllegalStateException("The download is not an app (damaged?)")
        if (new.packageName != context.packageName) throw IllegalStateException("The download is a different app (${new.packageName})")
        val mine = pm.getPackageInfo(context.packageName, flags)
        if (new.longVersionCode <= mine.longVersionCode)
            throw IllegalStateException("The download (${new.versionName}) is not newer than this app (${mine.versionName})")
        val a = signers(new)
        val b = signers(mine)
        if (a != null && b != null && a != b)
            throw IllegalStateException(
                if (isDebug(context)) "This is a test build, signed with a different key from the releases, so it cannot update itself. Install the release from GitHub once."
                else "The download is signed with a different key: not installed.",
            )
    }

    private fun signers(p: PackageInfo): Set<String>? = p.signingInfo?.apkContentsSigners?.map { it.toCharsString() }?.toSet()

    private fun install(context: Context, r: Release, apk: File) {
        set(State.Installing(r))
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            setSize(apk.length())
            // An app updating itself may skip the confirmation on Android 12+; Android asks anyway if it wants to.
            if (android.os.Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val id = installer.createSession(params)
        installer.openSession(id).use { s ->
            s.openWrite("base.apk", 0, apk.length()).use { out ->
                apk.inputStream().use { it.copyTo(out) }
                s.fsync(out)
            }
            val intent = Intent(context, UpdateReceiver::class.java).setAction(UpdateReceiver.ACTION).setPackage(context.packageName)
            val pi = PendingIntent.getBroadcast(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
            prefs.edit().putBoolean("updating", true).commit() // for UpdatedReceiver in the new version
            s.commit(pi.intentSender)
        }
        Log.i(TAG, "update: installing ${r.version}")
    }

    /** True once, in the new version, if the update came from here (not from adb or a file manager). */
    internal fun takeUpdatedFlag(context: Context): Boolean {
        init(context)
        val was = prefs.getBoolean("updating", false)
        if (was) prefs.edit().putBoolean("updating", false).apply()
        return was
    }

    internal fun installFailed(message: String) {
        val r = (state as? State.Installing)?.release
        if (::prefs.isInitialized) prefs.edit().putBoolean("updating", false).apply()
        set(State.Failed(message, r))
    }

    /** The state as JSON, for the web app's Settings (see UpdateBridge). */
    fun describe(context: Context): JSONObject {
        val s = state
        val o = JSONObject()
            .put("version", installedVersion(context))
            .put("versionCode", installedCode(context))
            .put("lastCheck", lastCheckMs)
        val rel = when (s) {
            is State.Available -> s.release
            is State.Downloading -> s.release
            is State.NeedsPermission -> s.release
            is State.Installing -> s.release
            is State.Failed -> s.release
            else -> null
        }
        o.put("state", when (s) {
            State.Idle -> "idle"
            State.Checking -> "checking"
            is State.UpToDate -> "up-to-date"
            is State.Available -> "available"
            is State.Downloading -> "downloading"
            is State.NeedsPermission -> "needs-permission"
            is State.Installing -> "installing"
            is State.Failed -> "failed"
        })
        if (rel != null) o.put("latest", rel.version).put("notes", rel.notes)
        if (s is State.Downloading) o.put("progress", s.progress.toDouble())
        if (s is State.Failed) o.put("message", s.message)
        return o
    }
}
