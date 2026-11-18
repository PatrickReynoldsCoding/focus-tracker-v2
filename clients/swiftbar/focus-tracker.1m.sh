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

case "$1" in
  stop)
    where=$(ask "Where did you stop?" "") || exit 0
    action stop "" --data-urlencode "where_stopped=$where"
    exit 0 ;;
  start|tick|habit|dismiss|pause|resume|next|extend)
    action "$1" "$2"
    exit 0 ;;
esac

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

grep -v "^#notify" <<< "$out" | sed "s|__SELF__|\"$0\"|g"
