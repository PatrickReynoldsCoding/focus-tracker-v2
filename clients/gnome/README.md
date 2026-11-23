# Focus Tracker on the GNOME desktop

Focus Tracker's Desktop page (`#/desktop`, DECISIONS D64) in a window of its own that stays on screen
all day, behind your other windows. Spec: `docs/desktop-widget-spec.md`.

Three parts, all installed by `install.sh`:

- `app/`: the **Focus Tracker Desktop app**, a small GNOME window (GJS, GTK 3 and WebKitGTK) that shows
  the Desktop page with no title bar, the way the Android app shows the web app: every panel is the
  web app's own. A ⚙ in its top right corner opens a menu.
- `focus-tracker-desktop.desktop`: its launcher (“Focus Tracker Desktop” in the app grid).
- `extension/`: a **GNOME Shell extension** that pins the window behind the others. Wayland does not
  let any window, native or not, place itself or stay below the others, so the shell does it.

## Install

```sh
clients/gnome/install.sh
```

- `FT_URL` sets another address (self-hosting), for example
  `FT_URL=https://tracker.example.com clients/gnome/install.sh`. The default is the owner's Worker.
- `FT_CHROME_PROFILE` sets the Chrome profile that **Open full app** uses (the folder name in
  `~/.config/google-chrome`); the default is `Profile 2`, and an empty value uses the usual browser.
- They are saved in `~/.config/focus-tracker-desktop/config.json`.

Then **log out and in**: GNOME loads a new extension, or a new version of it, only at login. When the
script finds an older copy loaded in this session it turns it off and says to run
`gnome-extensions enable focus-tracker-desktop@focus-tracker` after logging in again (turning it on
before would run the older copy).

**Sign in once** in the window: the app keeps its own sign-in (`~/.local/share/focus-tracker-desktop/web`),
apart from Chrome's.

Remove everything with `clients/gnome/install.sh --remove` (the sign-in is kept).

## The app (`app/main.js`)

Run on its own with `gjs -m clients/gnome/app/main.js` (`FT_URL` sets the address). Its app id is
`dev.focustracker.Desktop`; opening it again shows the window that is open. The ⚙ menu:

- **Add panel…** and **Remove panel ▸** (the panels on the Desktop by name): the page's own Add panel
  and Remove, through `window.ftDesktop` (`web/src/features/desktop/app.ts`).
- **Position ▸ Left, Middle, Right, Custom**, **Move and resize**, **More settings…** (the extension's
  settings window): the extension's settings, so the app and that window change the same thing.
- **Open full app**: Focus Tracker in its Chrome app window (or the usual browser) at Today.
- **Reload**, **Close**.

The page knows it is inside the app by `FocusTrackerDesktop` in the user agent: it hides its own + in
the corner, and a link to any other page (a project, a list) opens that page in the full app while the
window stays on the Desktop. Links to other sites open in the usual browser.

## The extension (`extension/`)

`focus-tracker-desktop@focus-tracker`, GNOME Shell 50. It pins the app's window (app id
`dev.focustracker.Desktop`), or any window titled exactly “Focus Tracker Desktop” (a Chrome app window
on `#/desktop`; a browser tab's title ends in “ - Google Chrome”, so it never matches). It:

- makes it a desktop-type window: below every normal window, above the desktop icons, and left out of
  the dock, Alt+Tab and the overview;
- shows it on every workspace;
- places it on the main screen's free area (under the top bar, beside a fixed dock) where its
  settings say: **Left** (the default) or **Right**, full height; **Middle**, centred, at the height set
  for the middle (0 = full height); at the width set (default 600 px); or **Custom**, where you left it
  with Move and resize, kept on the screen. It goes back there when it is moved, resized, maximised or
  minimised;
- opens the app at login if it is not open (after about 8 seconds).

**Move and resize**: the app shows a bar (“⠿ Drag here to move”, “⤡ Drag to resize”, **Done**) and a
corner handle. Pressing one sets the `drag` setting; the extension then moves the window, or its
bottom right corner, with the pointer until the button is let go, and saves the place as Custom. The
window stays pinned throughout.

Clicks and typing work as in any window. Turning the extension off gives the window back as a normal
window. Settings: the ⚙ menu, `gnome-extensions prefs focus-tracker-desktop@focus-tracker`, or the
Extensions app.

Two things learned the hard way (see `extension.js`):

- **Never put the window back on every workspace while GNOME is closing it.** GNOME takes a closing
  window off every workspace; an earlier version answered by sticking it again, and GNOME Shell
  crashed (`meta_window_unmanage` assertion), which logs you out. The extension lets go of the window
  as soon as GNOME starts closing it (`unmanaging`).
- **Do not switch a pinned window between normal and desktop types.** An earlier Move and resize did,
  and the overview logged errors; it now moves the window itself.

GNOME logs a harmless `meta_window_config_new_from` warning when a menu opens from the pinned window.

## Testing a change without risking your session

`test/run.sh` runs a second, hidden GNOME Shell (headless, its own D-Bus, settings and data folders),
so a broken extension cannot affect the desktop you are using:

```sh
npm run build && npx wrangler dev --port 8791 &      # a local tracker (optional)
FT_URL=http://localhost:8791 clients/gnome/test/run.sh /tmp/ft-gnome-test
```

It installs `../extension` and a test probe (`test/probe@focus-tracker-test`) and opens the app at
“login” (without `FT_URL`, a Chrome window on `test/pages/desktop.html`). The probe writes the windows'
places, types, stacking, focus, the Alt+Tab list and the overview's windows to
`/tmp/ft-gnome-test/probe/state.json` every 400 ms, and runs commands written to
`/tmp/ft-gnome-test/probe/cmd` (click, drag, type, close, screenshot, overview, workspaces, turning
extensions on and off; see its `extension.js`). `/tmp/ft-gnome-test/shell.log` has the shell's output:
look for `Bail out` (a crash) and `JS ERROR`. Always close the window in a test: the crash above only
happened then. With `mutter-dev-bin` installed, `gnome-shell --devkit --wayland` shows a test shell in
a window instead.
