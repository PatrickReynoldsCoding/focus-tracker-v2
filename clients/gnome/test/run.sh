#!/usr/bin/env bash
# Runs a hidden GNOME Shell 50 (headless, its own D-Bus, settings and data folders) with the
# extension in ../extension and the test probe, so a change can be tried without touching your
# session. The launcher opens the app (../app/main.js) on $FT_URL when it is set (a local server such
# as `npx wrangler dev`), else pages/desktop.html (titled "Focus Tracker Desktop") in a Chrome of its own.
#   clients/gnome/test/run.sh [state folder]      (default /tmp/ft-gnome-test; runs until killed)
# Then write commands to <state>/probe/cmd and read <state>/probe/state.json (see the probe's
# extension.js). <state>/bus holds the test shell's D-Bus address, <state>/shell.log its output.
# Open another window in it:  clients/gnome/test/run.sh --window <state> <page.html>
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
if [[ "${1:-}" == "--window" ]]; then
  S="$2"
  DBUS_SESSION_BUS_ADDRESS="$(cat "$S/bus")" WAYLAND_DISPLAY=ft-test-0 DISPLAY= setsid google-chrome --user-data-dir="$S/chrome" --ozone-platform=wayland --disable-gpu --no-first-run --no-default-browser-check "--app=file://$3" >/dev/null 2>&1 &
  exit 0
fi
S="${1:-/tmp/ft-gnome-test}"
uuid=focus-tracker-desktop@focus-tracker
ext="$S/xdg/gnome-shell/extensions"
rm -rf "$ext" "$S/probe" "$S/shell.log"
mkdir -p "$ext/$uuid" "$S/xdg/applications" "$S/cfg/glib-2.0/settings" "$S/probe"
cp -r "$here/../extension/." "$ext/$uuid/"
glib-compile-schemas "$ext/$uuid/schemas"
cp -r "$here/probe@focus-tracker-test" "$ext/"
if [[ -n "${FT_URL:-}" ]]; then
  launch="env FT_URL=$FT_URL gjs -m $here/../app/main.js"
else
  launch="google-chrome --user-data-dir=$S/chrome --ozone-platform=wayland --disable-gpu --no-first-run --no-default-browser-check \"--app=file://$here/pages/desktop.html\""
fi
cat > "$S/xdg/applications/focus-tracker-desktop.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Focus Tracker Desktop
Exec=$launch
Terminal=false
DESKTOP
printf "[org/gnome/shell]\nenabled-extensions=['probe@focus-tracker-test', '%s']\ndisable-user-extensions=false\n" "$uuid" > "$S/cfg/glib-2.0/settings/keyfile"
export XDG_DATA_HOME="$S/xdg" XDG_CONFIG_HOME="$S/cfg" GSETTINGS_BACKEND=keyfile FT_PROBE_DIR="$S/probe" XDG_CURRENT_DESKTOP=GNOME XDG_SESSION_TYPE=wayland
unset DISPLAY WAYLAND_DISPLAY
exec dbus-run-session -- bash -c "
  echo \$DBUS_SESSION_BUS_ADDRESS > '$S/bus'
  gnome-shell --headless --wayland --no-x11 --virtual-monitor 1680x1050 --wayland-display ft-test-0 > '$S/shell.log' 2>&1 &
  echo \$! > '$S/shell.pid'
  wait
"
