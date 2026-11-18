# Focus Tracker for Android

A small native app (Kotlin, no Compose) with:

- **The tracker itself**: the web app in a full-screen WebView, signed in, with links to other sites opening in the browser.
- **Today widget** (4 × 3, resizable): today's focus project and next action, a running session's timer and pomodoro phase, then the to-dos due today and the habits left. Tap a to-do to tick it, a habit to count a session, Start to start a session on the focus project. Stop… and the project name open the app. **+** adds a to-do for today.
- **Notifications** for reminders, habit prompts and pomodoro breaks (checked every 15 minutes with WorkManager; each shown once across all devices).

The app's screens are the web app on purpose: one UI to keep up, and the native part is only what Android needs native code for (widgets, notifications).

## Install

`focus-tracker-0.1.0.apk` (signed with the same key as the owner's other apps) or build it:

```sh
./gradlew assembleRelease   # app/build/outputs/apk/release/app-release.apk
adb install -r app/build/outputs/apk/release/app-release.apk
```

Open it, type the tracker's address and password, choose which mode the widget shows. The app signs in and makes an API token called "Android (<model>)" (revoke it in Settings → Devices and API tokens). Then long-press the home screen → Widgets → Focus → "Focus today".

## Build notes

- Gradle 9.6 (runs on the Java 25 installed here), AGP 8.7.3, Kotlin 2.0.21, minSdk 30 (Android 11), targetSdk 35.
- Release lint is off: AGP 8.7's lint cannot run on Java 25.
- Debug builds allow plain http to `10.0.2.2` only, for testing in the emulator against `npx wrangler dev`.
- `./gradlew testDebugUnitTest` checks the status parsing against the server's `/api/status` shape.

## Tested

On the Android 15 emulator against a local server (2026-11-18): setup and sign-in, the web app signed in and clear of the system bars, the widget showing focus, next action, to-dos and habits, ticking a to-do, starting a session (timer and pomodoro shown), and quick add. Not yet tried on a real phone or with the e-ink Android 11 phone.
