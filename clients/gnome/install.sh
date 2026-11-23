#!/usr/bin/env bash
# Install (or with --remove, remove) Focus Tracker Desktop for GNOME (DECISIONS D64, README.md):
# the app (app/main.js: the Desktop page in a window with no title bar and a ⚙ menu), its launcher,
# and the GNOME Shell extension that pins its window behind the other windows.
#   FT_URL             the tracker's address (default: the owner's Cloudflare Worker)
#   FT_CHROME_PROFILE  the Chrome profile "Open full app" uses (default: "Profile 2"; empty: the usual browser)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
data="${XDG_DATA_HOME:-$HOME/.local/share}"
config="${XDG_CONFIG_HOME:-$HOME/.config}/focus-tracker-desktop"
apps="$data/applications"
icons="$data/icons/hicolor"
appdir="$data/focus-tracker-desktop/app"
uuid="focus-tracker-desktop@focus-tracker"
ext="$data/gnome-shell/extensions/$uuid"
url="${FT_URL:-https://focus-tracker.focus-tracker.workers.dev}"
url="${url%/}"
profile="${FT_CHROME_PROFILE-Profile 2}"

# Whether this GNOME session has the extension loaded (a new version only loads at the next login).
loaded=0
gnome-extensions info "$uuid" >/dev/null 2>&1 && loaded=1

if [[ "${1:-}" == "--remove" ]]; then
  gnome-extensions disable "$uuid" 2>/dev/null || true
  list="$(gsettings get org.gnome.shell enabled-extensions)"
  gsettings set org.gnome.shell enabled-extensions "$(sed -e "s/'$uuid'//; s/\[, /[/; s/, ,/,/; s/, \]/]/" <<<"$list")"
  rm -rf "$ext" "$appdir"
  rm -f "$apps/focus-tracker-desktop.desktop" "$icons/512x512/apps/focus-tracker-desktop.png" "$icons/scalable/apps/focus-tracker-desktop.svg"
  echo "Removed the app, its launcher and the extension (your sign-in stays in $data/focus-tracker-desktop/web)."
  exit 0
fi

# The app and its settings.
mkdir -p "$appdir" "$config" "$apps" "$icons/512x512/apps" "$icons/scalable/apps"
cp "$here/app/main.js" "$appdir/main.js"
printf '{ "url": "%s", "chromeProfile": %s }\n' "$url" "$([[ -n "$profile" ]] && printf '"%s"' "$profile" || echo null)" > "$config/config.json"
sed -e "s|@APP@|$appdir/main.js|" "$here/focus-tracker-desktop.desktop" > "$apps/focus-tracker-desktop.desktop"
cp "$here/../../web/public/icon-512.png" "$icons/512x512/apps/focus-tracker-desktop.png"
cp "$here/../../web/public/icon.svg" "$icons/scalable/apps/focus-tracker-desktop.svg"
update-desktop-database "$apps" 2>/dev/null || true

# The extension. An older copy still loaded in this session is turned off first (it gives the window
# back), and the new one is not turned on until the next login: turning it on now would run the old
# copy GNOME still holds.
# An unchanged extension is left alone (and stays on).
same=0
diff -rq -x gschemas.compiled "$here/extension" "$ext" >/dev/null 2>&1 && same=1
if [[ $same == 0 ]]; then
  if [[ $loaded == 1 ]]; then gnome-extensions disable "$uuid" 2>/dev/null || true; fi
  rm -rf "$ext"
  mkdir -p "$ext"
  cp -r "$here/extension/." "$ext/"
  glib-compile-schemas "$ext/schemas"
fi

echo "Installed the app (“Focus Tracker Desktop” in the app grid), its launcher and the extension."
if [[ $same == 1 ]]; then
  echo "The extension has not changed. Close the window (⚙ → Close) and open Focus Tracker Desktop again for the new app."
elif [[ $loaded == 1 ]]; then
  echo "Log out and in, then turn the extension on: gnome-extensions enable $uuid"
else
  # GNOME does not know it yet, so it is safe to put it on the enabled list: it loads at the next login.
  list="$(gsettings get org.gnome.shell enabled-extensions)"
  if [[ "$list" != *"'$uuid'"* ]]; then
    if [[ "$list" == "@as []" || "$list" == "[]" ]]; then list="['$uuid']"; else list="${list%]}, '$uuid']"; fi
    gsettings set org.gnome.shell enabled-extensions "$list"
  fi
  echo "Log out and in once: GNOME loads a new extension only at login. The window then opens and pins itself."
fi
echo "Sign in once in the window (it keeps its own sign-in)."
