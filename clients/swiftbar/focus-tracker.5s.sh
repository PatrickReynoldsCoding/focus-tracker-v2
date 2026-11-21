#!/bin/bash
# <xbar.title>Focus Tracker</xbar.title>
# <xbar.desc>Today's focus, session timer, to-dos, habits and reminders from your Focus Tracker.</xbar.desc>
# <xbar.dependencies>curl</xbar.dependencies>
# <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
# <swiftbar.hideDisablePlugin>true</swiftbar.hideDisablePlugin>
#
# Setup: see clients/swiftbar/README.md. Needs ~/.config/focus-tracker/swiftbar.env with
#   FT_URL=https://your-tracker.workers.dev
#   FT_TOKEN=ft_...           (Settings → Devices and API tokens)
#   FT_MODE=personal          (optional)

CONFIG="${FT_CONFIG:-$HOME/.config/focus-tracker/swiftbar.env}"
# shellcheck disable=SC1090
[ -f "$CONFIG" ] && . "$CONFIG"
if [ -z "$FT_URL" ] || [ -z "$FT_TOKEN" ]; then
  echo "◎ setup"
  echo "---"
  echo "Create $CONFIG with FT_URL and FT_TOKEN"
  exit 0
fi

api() { curl -fsS --max-time 10 -H "Authorization: Bearer $FT_TOKEN" -H "X-Mode: ${FT_MODE:-personal}" "$@"; }
action() { api -X POST "$FT_URL/api/swiftbar/action" --data-urlencode "action=$1" --data-urlencode "id=$2" "${@:3}" >/dev/null; }

notify() {
  # terminal-notifier if installed (clickable), otherwise AppleScript.
  if command -v terminal-notifier >/dev/null 2>&1; then
    terminal-notifier -title "Focus Tracker" -subtitle "$1" -message "${2:- }" -open "$FT_URL/#/today" >/dev/null 2>&1
  else
    osascript -e 'on run argv' -e 'display notification (item 2 of argv) with title "Focus Tracker" subtitle (item 1 of argv)' -e 'end run' "$1" "${2:- }" >/dev/null 2>&1
  fi
}

ask() {
  osascript -e 'on run argv' -e 'text returned of (display dialog (item 1 of argv) default answer (item 2 of argv) with title "Focus Tracker")' -e 'end run' "$1" "$2" 2>/dev/null
}

CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/focus-tracker-swiftbar.${FT_MODE:-personal}.txt"
mkdir -p "$(dirname "$CACHE")"

case "$1" in
  stop)
    where=$(ask "Where did you stop?" "") || exit 0
    action stop "" --data-urlencode "where_stopped=$where"
    exit 0 ;;
  start|tick|card|habit|dismiss|pause|resume|next|extend|pomodoro-start|pomodoro-next|pomodoro-pause|pomodoro-resume|pomodoro-stop)
    action "$1" "$2"
    rm -f "$CACHE"
    exit 0 ;;
esac

# The plugin runs every 5 seconds so a Pomodoro countdown can tick, but it only asks the server every 30 seconds
# (and right after an action); in between it redraws the saved text.
if [ -f "$CACHE" ] && [ $(( $(date +%s) - $(stat -f %m "$CACHE") )) -lt 30 ]; then
  out=$(cat "$CACHE")
else
  if ! out=$(api "$FT_URL/api/swiftbar"); then
    echo "◎ ⚠"
    echo "---"
    echo "Cannot reach Focus Tracker | color=red"
    echo "Refresh | refresh=true"
    exit 0
  fi
  # New notifications: show them once, then tell the server they were seen.
  while IFS=$'\t' read -r tag id title body; do
    [ "$tag" = "#notify" ] || continue
    notify "$title" "$body"
    action seen "$id" &
  done <<< "$out"
  wait
  printf '%s\n' "$out" | grep -v "^#notify" > "$CACHE"
  out=$(cat "$CACHE")
fi

# @@P:<epoch>@@ is the end of the running Pomodoro period: show the time left.
if [[ "$out" =~ @@P:([0-9]+)@@ ]]; then
  left=$(( BASH_REMATCH[1] - $(date +%s) ))
  [ "$left" -lt 0 ] && left=0
  out=${out//"${BASH_REMATCH[0]}"/$(printf '%d:%02d' $((left / 60)) $((left % 60)))}
fi
sed "s|__SELF__|\"$0\"|g" <<< "$out"
