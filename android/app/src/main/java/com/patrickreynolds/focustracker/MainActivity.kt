package com.patrickreynolds.focustracker

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.window.OnBackInvokedDispatcher
import kotlin.concurrent.thread

/** The app's screens are the tracker's web app; this activity hosts it and keeps the widgets fresh. */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var updateBar: UpdateBar

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = Prefs(this)
        if (!prefs.ready) {
            startActivity(Intent(this, SetupActivity::class.java))
            finish()
            return
        }
        web = WebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        CookieManager.getInstance().setAcceptCookie(true)
        web.webChromeClient = WebDialogs(this)
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // Links to other sites (resources) open in the browser.
                if (request.url.host == Uri.parse(prefs.url).host) return false
                startActivity(Intent(Intent.ACTION_VIEW, request.url))
                return true
            }

            override fun onPageFinished(view: WebView, url: String?) {
                if (Uri.parse(url ?: "").host == Uri.parse(prefs.url).host) readProfile()
            }
        }
        // Android 15 draws behind the status and navigation bars: keep the page clear of them.
        // (A WebView ignores its own padding, so a frame around it takes the insets.)
        // The update bar (UpdateBar.kt) sits above the web app and shows only when there is an update to act on.
        web.addJavascriptInterface(UpdateBridge(this), UpdateBridge.NAME)
        updateBar = UpdateBar(this)
        val column = android.widget.LinearLayout(this)
        column.orientation = android.widget.LinearLayout.VERTICAL
        column.addView(updateBar)
        column.addView(web, android.widget.LinearLayout.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        val frame = android.widget.FrameLayout(this)
        frame.addView(column)
        frame.setOnApplyWindowInsetsListener { v, insets ->
            val bars = insets.getInsets(android.view.WindowInsets.Type.systemBars() or android.view.WindowInsets.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        setContentView(frame)
        if (intent.getBooleanExtra(EXTRA_PIN_WIDGET, false)) pinWidget()
        web.loadUrl(address(prefs, intent))
        openLink(intent)
        if (Build.VERSION.SDK_INT >= 33) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { goBack() }
        }
        RefreshWorker.schedule(this)
        Updater.init(this)
        if (intent.hasExtra(EXTRA_UPDATE_URL)) Updater.setTestUrl(this, intent.getStringExtra(EXTRA_UPDATE_URL)) // debug builds only
        Updater.checkIfDue(this) // at most every few hours
    }

    override fun onStart() {
        super.onStart()
        if (::updateBar.isInitialized) updateBar.start()
    }

    override fun onStop() {
        super.onStop()
        if (::updateBar.isInitialized) updateBar.stop()
    }

    override fun onResume() {
        super.onResume()
        Updater.continueInstall(this) // back from Android's "install unknown apps" page
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.hasExtra(EXTRA_UPDATE_URL)) Updater.setTestUrl(this, intent.getStringExtra(EXTRA_UPDATE_URL))
        if (intent.hasExtra(EXTRA_FRAGMENT)) web.loadUrl(address(Prefs(this), intent))
        openLink(intent)
        if (intent.getBooleanExtra(EXTRA_PIN_WIDGET, false)) pinWidget()
    }

    override fun onPause() {
        super.onPause()
        // Changes made in the app show on the widget when you go back to the home screen.
        // Each widget keeps its own profile (D51); the alarm follows the app's profile, as the notifications do.
        val app = applicationContext
        thread {
            TodayWidget.refresh(app)
            FilesWidget.refresh(app)
            SingleFileWidget.refresh(app)
        }
        readProfile { thread { RefreshWorker.scheduleAlarm(app) } }
    }

    /** Note the profile the web app has open (TodayProfile: quick add and notifications use it; no widget does), then `then`. */
    private fun readProfile(then: () -> Unit = {}) {
        if (!::web.isInitialized) { then(); return }
        val app = applicationContext
        web.evaluateJavascript(TodayProfile.SCRIPT) { result ->
            TodayProfile.fromScript(result)?.let { Prefs(app).appProfile = it }
            then()
        }
    }

    /** A link from the Files widget opens in the browser (web addresses only). */
    private fun openLink(intent: Intent?) {
        val url = intent?.getStringExtra(EXTRA_OPEN_URL) ?: return
        val uri = Uri.parse(url)
        if (uri.scheme != "https" && uri.scheme != "http") return
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }

    /** Ask the launcher to add the Today widget (also reachable with: am start ... --ez ft.pinWidget true), in the app's open profile. */
    private fun pinWidget() {
        val m = getSystemService(android.appwidget.AppWidgetManager::class.java)
        val profile = Prefs(this).appProfile.ifEmpty { "personal" }
        if (m.isRequestPinAppWidgetSupported) m.requestPinAppWidget(android.content.ComponentName(this, TodayWidget::class.java), null, TodayWidget.pinnedCallback(this, profile))
    }

    private fun goBack() {
        if (::web.isInitialized && web.canGoBack()) web.goBack() else finish()
    }

    @Deprecated("Android 11 and 12")
    override fun onBackPressed() = goBack()

    companion object {
        const val EXTRA_FRAGMENT = "ft.fragment"
        /** The profile to open the page in (every widget opens the app in its own profile); the web app takes `?profile=` off the address (D44). */
        const val EXTRA_PROFILE = "ft.profile"
        /** A web address to open in the browser (a link in the Files widget). */
        const val EXTRA_OPEN_URL = "ft.openUrl"

        /** The web app's address for a page (EXTRA_FRAGMENT), in a profile when EXTRA_PROFILE is given (a full load, so it is set before anything draws). */
        fun address(prefs: Prefs, intent: Intent?): String {
            val fragment = intent?.getStringExtra(EXTRA_FRAGMENT) ?: "/today"
            val profile = intent?.getStringExtra(EXTRA_PROFILE)?.takeIf { it.isNotEmpty() }
            return prefs.url + "/" + (if (profile != null) "?profile=" + java.net.URLEncoder.encode(profile, "UTF-8") else "") + "#" + fragment
        }
        const val EXTRA_PIN_WIDGET = "ft.pinWidget"
        /** Debug builds only: where the updater looks for releases (a local test server). */
        const val EXTRA_UPDATE_URL = "ft.updateUrl"
    }
}
