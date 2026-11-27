# Focus Tracker for Android

A small native app (Kotlin, no Compose) with:

- **The tracker itself**: the web app in a full-screen WebView, signed in, with links to other sites opening in the browser.
- **Today widget** (2 × 3 by default, resizable down to 2 cells wide; a narrow layout below 200 dp with the timer and its button stacked, a compact one up to 230 dp): today's focus project and next action, a running session's timer and pomodoro phase, then the Today list (the habits, to-dos and cards left today, as on the web app's Today; without it, the to-dos due and habits left). Habits sit under their category headings (D70; none when no habit has a category); tap a heading to fold it, remembered per widget. Tap a to-do or card to tick it, a habit to count a session, **✕** on every row to put it off for today (Not today; 0.4.2: daily habits too), Start to start a session on the focus project. Stop… and the project name open the app (in the widget's profile). **+** adds a to-do for today in the profile open in the app. **⚙** changes the widget's profile. Since 0.5.0 it shows the profile chosen in its settings and keeps it, whatever the app has open (0.4.1-0.4.2: the profile open in the app; before: the server's default); an empty list says which profile it is in. When the server does not answer, the saved copy shows with "Offline · saved 10:42" (or why it failed); an answer it cannot read is an error, never an empty list.
- **Files widget** ("Focus files", 2 × 3, down to 2 wide; D44): like Google Keep's, a scrolling list of the notes, lists and to-dos of a folder (and the folders inside it), a tag or the whole profile, newest first or by name; each card shows the title, its kind and project, and the start of the text (a note's text without Markdown marks, a list's or to-do's items), cut to the length chosen in characters or lines. Tap a card to open the file in the app (in the widget's profile); a to-do's card lists its open items, each with ☐: tap one to tick it (0.5.0; plain lists and notes have no ticks); tap the title to open the folder or tag on Files; ⚙ changes the settings.
- **Single file widget** ("Focus file", 2 × 2, down to 2 wide): one note (its text in paragraphs) or list or to-do (its items), scrolling, cut to the length chosen. Tap a to-do's item to tick or untick it; anything else opens the file.
- **Widget settings** (on adding any widget, from its ⚙, or a long press → Reconfigure on Android 12+): the profile (the Today widget asks only this); what it shows (every file, a folder, a tag; whiteboards and links too) or, for a single file, the file (recently changed, a folder, a tag, or search); the length (characters or lines, a slider); the order. Both widgets read `GET /api/widget/files` and `GET /api/widget/file/:kind/:id` (one small request each), draw the saved copy at once and show "Offline · saved …" when the server does not answer in time.
- **Profiles** (0.5.0, D51): every widget keeps its own profile and never follows the app's open profile or the server's default; opening a file or project from a widget switches the app to that profile without changing any widget. A widget whose profile was deleted says "Profile removed: tap to choose". Today widgets placed before 0.5.0 keep, once, the profile they last showed (the app's open profile). Quick add, notifications and the pomodoro alarm follow the app's open profile.
- **How the widgets stay fresh** (0.6.0, D69; no push service): while the screen is on, every widget is redrawn about every minute, so a change made on a computer or by Claude shows within a minute or so. An alarm (`WidgetTicker.kt`) goes off every 60 seconds and sets itself again; screen off, it fetches nothing and looks again in 5 minutes. It never wakes the phone (an `RTC` alarm, not `RTC_WAKEUP`), so while the phone sleeps it waits overdue and goes off soon after the screen comes on. It is exact where Android allows it (as for the pomodoro alarm) and inexact (`setAndAllowWhileIdle`) where it does not. While the app's process is alive, screen on and unlock redraw at once too. Each redraw sends the same small requests as before: one `/api/status` per Today widget profile, one per Files or Single file widget. It is skipped when the phone is offline and when one started under 20 seconds ago, and two never run at once (`RefreshGate`). The alarm runs only while a widget is placed. It starts when a widget is placed or Android redraws one, after the phone restarts or the app is updated, and when the app opens. It stops when the last widget is removed. Changes made in the app still show about 1.5 seconds later (the web app calls `FocusTrackerAndroid.refreshWidgets`), and the 15-minute WorkManager refresh and Android's 30-minute widget update stay as the fallback. Battery savers on some phones (Xiaomi, Huawei, Samsung "deep sleep") can stop the alarm; then the widgets fall back to those.
- **Notifications** for reminders, habit prompts and pomodoro breaks (checked every 15 minutes with WorkManager; each shown once across all devices). Pomodoro and "Time is up" alerts are on time: the app sets an exact alarm for the next one whenever it reads the status (Android 11: always allowed; 12: falls back to an alarm-clock alarm, which shows a clock icon, if exact alarms are switched off; 13+: allowed at install).

The app's screens are the web app on purpose: one UI to keep up, and the native part is only what Android needs native code for (widgets, notifications).

## Install

`focus-tracker-0.1.0.apk` (signed with the same key as the owner's other apps) or build it:

```sh
./gradlew assembleRelease   # app/build/outputs/apk/release/app-release.apk
adb install -r app/build/outputs/apk/release/app-release.apk
```

Open it, type the tracker's address and password. The app signs in and makes an API token called "Android (<model>)" (revoke it in Settings → Devices and API tokens). Then long-press the home screen → Widgets → Focus → "Focus today", "Focus files" or "Focus file", and choose its profile (and for the Files widgets, what it shows).

## Updating from inside the app

The app updates itself from GitHub, the way the owner's Steady app does. It checks when it opens (at most every 4 hours) and from Settings → Android app → **Check for updates** (that section shows only inside the app). When there is an update a bar appears above the web app: **Update to X.Y.Z** with **Update**, **Release notes** and **Later**. Update downloads the APK with a progress bar, checks it is this app, newer and signed with the same key, and installs it with Android's installer. The first time, Android asks you to allow Focus to install apps ("Allow from this source", then back); then it asks you to confirm. Your sign-in, settings and widgets are kept, and a notification says "Focus Tracker updated to X.Y.Z".

**How to publish a release the updater sees** (the lead does this; the app never needs a new setup):

1. Bump `versionCode` and `versionName` in `app/build.gradle.kts`, run `./gradlew assembleRelease`. It must be signed with the owner's key (`~/.android-keys/mpe-instruments.properties`), the same key as the installed app, or Android refuses the update.
2. Publish a normal GitHub release (not a draft, not a pre-release), tagged `vX.Y.Z` for the project, with **one asset named `focus-tracker-<versionName>.apk`** (copy `app-release.apk` to that name), for example `focus-tracker-0.3.0.apk`.
3. Put a line of its own in the release notes: `versionCode: 3` (the app's `versionCode`). The app strips that line and shows the rest as the release notes.

```sh
cp app/build/outputs/apk/release/app-release.apk /tmp/focus-tracker-0.3.0.apk
gh release create v0.6.0 /tmp/focus-tracker-0.3.0.apk --title "v0.6.0" --notes $'What to try.\n\nversionCode: 3'
```

Releases without an APK (web-only) are fine: the app looks through the last 30 releases for the newest APK. Drafts and pre-releases are ignored. The version compared is the file name's, not the tag's. If the `versionCode:` line is missing the app compares version names instead, and the downloaded file's own versionCode is checked again before installing. Only `https://github.com/PatrickReynoldsCoding/focus-tracker-v2/releases/download/...` is accepted.

**Testing an update without publishing** (debug builds only):

```sh
./gradlew assembleDebug -Pft.versionCode=1 -Pft.versionName=0.1.0   # the old build; copy app-debug.apk away
./gradlew assembleDebug                                              # the new build (3 / 0.3.0); serve it as focus-tracker-0.3.0.apk
# a folder served on port 8810 with the APK and releases.json (a copy of GitHub's releases list, the asset's
# browser_download_url pointing at http://10.0.2.2:8810/focus-tracker-0.3.0.apk, notes ending "versionCode: 3")
adb install -r old.apk
adb shell am start -n com.patrickreynolds.focustracker/.MainActivity --es ft.updateUrl http://10.0.2.2:8810/releases.json
```

Then Settings → Android app → Check for updates → Update. Both builds must be debug-signed (a debug build cannot update to a release-signed one: different keys). It was tried this way on the Android 15 emulator on 2026-11-18: check, notes, download, "install unknown apps", confirm, updated to 0.3.0 with the sign-in kept.

## Notification settings

The server applies Settings → Notifications (master switch, kinds, quiet hours, show on phone / Mac / web) before it serves anything, so the app only has to ask: it calls `/api/status?client=android`.

## Build notes

- Gradle 9.6 (runs on the Java 25 installed here), AGP 8.7.3, Kotlin 2.0.21, minSdk 30 (Android 11), targetSdk 35.
- Release lint is off: AGP 8.7's lint cannot run on Java 25.
- Debug builds allow plain http to `10.0.2.2` only, for testing in the emulator against `npx wrangler dev`.
- `./gradlew testDebugUnitTest` checks the status parsing against the server's `/api/status` shape, the widget feeds against `/api/widget/files`, the widget requests (each with its widget's profile), the profile given to Today widgets placed before 0.5.0, the Files widget's tick, the widget tick's timing and its one-at-a-time, debounced redraw (`WidgetTickerTest`), and that every widget's `*_widget_info.xml` goes down to 2 cells (and the narrow layouts keep the ids the code sets).

## Tested

0.6.0 (2026-11-27): unit tests (`WidgetTickerTest`, 46 in all, run for debug and release), the release build and its certificate (the same as 0.5.1), and the merged manifest (the app class, the tick and boot receivers, the permissions). Not tried on a device (no emulator was started): the minute tick with the screen on, no fetch with it off, the redraw on screen on and unlock, the tick starting again after a restart and stopping when the last widget is removed.

0.5.0 (2026-11-22): unit tests (`WidgetProfileTest`, 40 in all), the release build and its certificate (same as 0.4.2), and against a local server: a to-do's items in `/api/widget/files` with `X-Mode`, the tick endpoint in the widget's profile (404 in another profile), and `unknown_mode` for a deleted profile. Not tried on a device (the emulator crashes here): the Today widget's settings screen on adding and from ⚙ / Reconfigure, the migration of a widget already placed, ticking on the Files widget (the invisible tap step: whether a launcher shows a flash), "Profile removed", opening a file in another profile from a widget.

0.4.1 (2026-11-22): the "Nothing left today" bug reproduced against production (read-only) and a local server: with the default profile an empty Work, `/api/status` without a profile was empty while Personal had 8 items. Checked: unit tests (`TodayWidgetTest`), the requests the widget now sends (profile, Not today) against a local server, the release build and its certificate (same as 0.4.0). Not tried on a device (the emulator crashes here): the ✕ button, reading the app's profile from the WebView.

0.4.0 (2026-11-22): the emulator crashes on the build machine, so the widgets were not run. Checked instead: the unit tests above, the release build, the APK's signature (same certificate as 0.3.5), the server feeds (`test/widgets.test.ts`, a local server) and opening a file in another profile (`scripts/ui/open-link.mjs`). Not tried: placing, resizing and setting up the widgets, ticking, the narrow layouts on a launcher.

On the Android 15 emulator against a local server (2026-11-18): setup and sign-in, the web app signed in and clear of the system bars, the widget showing focus, next action, to-dos and habits, ticking a to-do, starting a session (timer and pomodoro shown), and quick add. Not yet tried on a real phone or with the e-ink Android 11 phone.
