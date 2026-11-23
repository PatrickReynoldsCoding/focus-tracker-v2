#!/usr/bin/env bash
# Install (or with --remove, remove) Focus Tracker Desktop for GNOME (DECISIONS D64, README.md):
# the launcher (a Chrome app window on the Desktop page, #/desktop) and the GNOME Shell extension
# that pins that window on the left, behind other windows.
#   FT_URL             the tracker's address (default: the owner's Cloudflare Worker)
#   FT_CHROME_PROFILE  the Chrome profile that is signed in to it (default: "Profile 2")
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
icons="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor"
uuid="focus-tracker-desktop@focus-tracker"
ext="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$uuid"
url="${FT_URL:-https://focus-tracker.focus-tracker.workers.dev}"
url="${url%/}"
profile="${FT_CHROME_PROFILE:-Profile 2}"

if [[ "${1:-}" == "--remove" ]]; then
  gnome-extensions disable "$uuid" 2>/dev/null || true
  list="$(gsettings get org.gnome.shell enabled-extensions)"
  gsettings set org.gnome.shell enabled-extensions "$(sed -e "s/'$uuid'//; s/\[, /[/; s/, ,/,/; s/, \]/]/" <<<"$list")"
  rm -rf "$ext"
  rm -f "$apps/focus-tracker-desktop.desktop" "$icons/512x512/apps/focus-tracker-desktop.png" "$icons/scalable/apps/focus-tracker-desktop.svg"
  echo "Removed the Focus Tracker Desktop launcher and extension. Log out and in to unload the extension."
  exit 0
fi

mkdir -p "$apps" "$icons/512x512/apps" "$icons/scalable/apps"
sed -e "s|@URL@|$url|" -e "s|@PROFILE@|$profile|" "$here/focus-tracker-desktop.desktop" > "$apps/focus-tracker-desktop.desktop"
cp "$here/../../web/public/icon-512.png" "$icons/512x512/apps/focus-tracker-desktop.png"
cp "$here/../../web/public/icon.svg" "$icons/scalable/apps/focus-tracker-desktop.svg"
update-desktop-database "$apps" 2>/dev/null || true

rm -rf "$ext"
mkdir -p "$ext"
cp -r "$here/extension/." "$ext/"
glib-compile-schemas "$ext/schemas"
fresh=1
gnome-extensions info "$uuid" >/dev/null 2>&1 && fresh=0
# GNOME only knows a new extension after the next login, so put it on the enabled list directly.
list="$(gsettings get org.gnome.shell enabled-extensions)"
if [[ "$list" != *"'$uuid'"* ]]; then
  if [[ "$list" == "@as []" || "$list" == "[]" ]]; then list="['$uuid']"; else list="${list%]}, '$uuid']"; fi
  gsettings set org.gnome.shell enabled-extensions "$list"
fi
gnome-extensions enable "$uuid" 2>/dev/null || true

echo "Installed the launcher (“Focus Tracker Desktop” in the app grid) and the extension."
if [[ $fresh == 1 ]]; then
  echo "Log out and in once: GNOME loads a new extension only at login. The window then opens and pins itself."
else
  echo "Log out and in to load the new version of the extension."
fi
