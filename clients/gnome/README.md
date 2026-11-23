# Focus Tracker on the GNOME desktop

Focus Tracker's Desktop page (`#/desktop`, DECISIONS D64) in a window of its own, for a window that
stays on screen all day. Spec: `docs/desktop-widget-spec.md`.

`install.sh` installs both parts below: the launcher and the GNOME Shell extension.

## The launcher (part 2)

`focus-tracker-desktop.desktop` opens the Desktop page as a Chrome app window (no tabs or address
bar) in the Chrome profile that is signed in to the tracker, so it needs no token.

Install it (and its icon) for your user:

```sh
clients/gnome/install.sh
```

Then open **Focus Tracker Desktop** from the app grid, or run `gtk-launch focus-tracker-desktop`.

- `FT_URL` sets another address (self-hosting), for example
  `FT_URL=https://tracker.example.com clients/gnome/install.sh`. The default is the owner's Worker.
- `FT_CHROME_PROFILE` sets another Chrome profile (the folder name in `~/.config/google-chrome`,
  such as `Default`). The default is `Profile 2`.
- Remove it with `clients/gnome/install.sh --remove`.

### Finding the window

The page sets the window title to **Focus Tracker Desktop** (`TITLE` in
`web/src/features/desktop/Desktop.tsx`), so the GNOME extension (part 3) finds the window by its
title. Chrome ignores `--class=` on Wayland; an `--app=` window gets an app id made from the address
(likely `chrome-focus-tracker.focus-tracker.workers.dev__-Profile_2`; not checked, GNOME does not let a
script list windows), and any other `--app=` window of the site would share it, so the title is the
reliable match. Before you are signed in the title is the
app's usual one.

## The extension (part 3)

`extension/` is a GNOME Shell extension (`focus-tracker-desktop@focus-tracker`, GNOME Shell 50)
that pins the window like a desktop widget. Wayland does not let a window place itself or stay below
the others, so the shell does it. When a window titled exactly “Focus Tracker Desktop” appears (a
browser tab's title ends in “ - Google Chrome”, so only the app window matches), it:

- makes it a desktop-type window: below every normal window, above the desktop icons, and left out of
  the dock, Alt+Tab and the overview;
- shows it on every workspace;
- puts it on the left of the main screen's free area (under the top bar, beside a fixed dock), full
  height, at the width in its settings (default 600 px), and puts it back when it is moved, resized,
  maximised or minimised;
- opens it at login if it is not open (after about 8 seconds, so a window Chrome reopens counts).

Clicks and typing work as in any window. Turning the extension off gives the window back as a normal
window.

### Install

`clients/gnome/install.sh` copies it to `~/.local/share/gnome-shell/extensions/`, builds its settings
schema and adds it to the enabled extensions. **Log out and in once**: GNOME only loads a new
extension (or a new version of it) at login. Check it with
`gnome-extensions info focus-tracker-desktop@focus-tracker`.

Settings (width, open at login): `gnome-extensions prefs focus-tracker-desktop@focus-tracker`, or the
Extensions app.

### Remove

`clients/gnome/install.sh --remove` turns it off, deletes it and the launcher. Or turn it off in the
Extensions app; the window becomes a normal window at once.

### Testing a change without risking your session

GNOME Shell 50 runs a second, hidden shell with its own D-Bus, settings and data folders, so a broken
extension cannot affect the desktop you are using:

```sh
S=/tmp/ft-gnome-test   # a folder for the test shell
mkdir -p $S/xdg/gnome-shell/extensions $S/cfg/glib-2.0/settings
cp -r clients/gnome/extension $S/xdg/gnome-shell/extensions/focus-tracker-desktop@focus-tracker
glib-compile-schemas $S/xdg/gnome-shell/extensions/focus-tracker-desktop@focus-tracker/schemas
printf "[org/gnome/shell]\nenabled-extensions=['focus-tracker-desktop@focus-tracker']\n" > $S/cfg/glib-2.0/settings/keyfile
XDG_DATA_HOME=$S/xdg XDG_CONFIG_HOME=$S/cfg GSETTINGS_BACKEND=keyfile dbus-run-session -- \
  gnome-shell --headless --wayland --no-x11 --virtual-monitor 1680x1050 --wayland-display ft-test-0
```

Open a window in it with `WAYLAND_DISPLAY=ft-test-0` and the test shell's D-Bus address, for example
`google-chrome --user-data-dir=$S/chrome --ozone-platform=wayland --app=file:///path/to/page.html` with a
page titled “Focus Tracker Desktop”. The extension logs “Focus Tracker Desktop: pinned …” to the
shell's output. A small helper extension that writes the windows' places, types and stacking order to a
file every half second is the easiest way to see what happened (the shell's `Eval` is off). With
`mutter-dev-bin` installed, `gnome-shell --devkit --wayland` shows the test shell in a window instead.

