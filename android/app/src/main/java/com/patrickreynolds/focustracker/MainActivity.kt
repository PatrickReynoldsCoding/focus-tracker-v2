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
        web.loadUrl(prefs.url + "/#" + (intent.getStringExtra(EXTRA_FRAGMENT) ?: "/today"))
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
        intent.getStringExtra(EXTRA_FRAGMENT)?.let { web.loadUrl(Prefs(this).url + "/#" + it) }
        if (intent.getBooleanExtra(EXTRA_PIN_WIDGET, false)) pinWidget()
    }

    override fun onPause() {
        super.onPause()
        // Changes made in the app show on the widget when you go back to the home screen.
        thread { TodayWidget.refresh(applicationContext) }
    }

    /** Ask the launcher to add the Today widget (also reachable with: am start ... --ez ft.pinWidget true). */
    private fun pinWidget() {
        val m = getSystemService(android.appwidget.AppWidgetManager::class.java)
        if (m.isRequestPinAppWidgetSupported) m.requestPinAppWidget(android.content.ComponentName(this, TodayWidget::class.java), null, null)
    }

    private fun goBack() {
        if (::web.isInitialized && web.canGoBack()) web.goBack() else finish()
    }

    @Deprecated("Android 11 and 12")
    override fun onBackPressed() = goBack()

    companion object {
        const val EXTRA_FRAGMENT = "ft.fragment"
        const val EXTRA_PIN_WIDGET = "ft.pinWidget"
        /** Debug builds only: where the updater looks for releases (a local test server). */
        const val EXTRA_UPDATE_URL = "ft.updateUrl"
    }
}
