#!/usr/bin/env bash
# Install (or with --remove, remove) the "Focus Tracker Desktop" launcher for GNOME: a Chrome app
# window on the Desktop page (#/desktop, DECISIONS D64). See README.md.
#   FT_URL             the tracker's address (default: the owner's Cloudflare Worker)
#   FT_CHROME_PROFILE  the Chrome profile that is signed in to it (default: "Profile 2")
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
icons="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor"
url="${FT_URL:-https://focus-tracker.focus-tracker.workers.dev}"
url="${url%/}"
profile="${FT_CHROME_PROFILE:-Profile 2}"

if [[ "${1:-}" == "--remove" ]]; then
  rm -f "$apps/focus-tracker-desktop.desktop" "$icons/512x512/apps/focus-tracker-desktop.png" "$icons/scalable/apps/focus-tracker-desktop.svg"
  echo "Removed the Focus Tracker Desktop launcher."
  exit 0
fi

mkdir -p "$apps" "$icons/512x512/apps" "$icons/scalable/apps"
sed -e "s|@URL@|$url|" -e "s|@PROFILE@|$profile|" "$here/focus-tracker-desktop.desktop" > "$apps/focus-tracker-desktop.desktop"
cp "$here/../../web/public/icon-512.png" "$icons/512x512/apps/focus-tracker-desktop.png"
cp "$here/../../web/public/icon.svg" "$icons/scalable/apps/focus-tracker-desktop.svg"
update-desktop-database "$apps" 2>/dev/null || true
echo "Installed. Open “Focus Tracker Desktop” from the app grid, or run: gtk-launch focus-tracker-desktop"
