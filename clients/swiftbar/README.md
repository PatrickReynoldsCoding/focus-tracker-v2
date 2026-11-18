# Focus Tracker in the Mac menu bar (SwiftBar)

Shows today's focus project and the session timer (with pomodoro) in the menu bar. The menu lists the next action, to-dos due today, habits left and reminders. Click a to-do to tick it, a habit to count a session, a reminder to dismiss it, or Start / Stop session. New reminders, habit prompts and pomodoro breaks arrive as macOS notifications, each once.

## Set up

1. Install [SwiftBar](https://github.com/swiftbar/SwiftBar) (`brew install swiftbar`) and choose a plugin folder.
2. Copy `focus-tracker.1m.sh` into that folder and make it runnable: `chmod +x focus-tracker.1m.sh`. The `1m` in the name means it refreshes every minute.
3. In Focus Tracker, open Settings → Devices and API tokens, add a token called "Mac menu bar" and copy it.
4. Create `~/.config/focus-tracker/swiftbar.env`:

   ```sh
   FT_URL=https://your-tracker.example.workers.dev
   FT_TOKEN=ft_...
   FT_MODE=personal   # or work
   ```

   Then `chmod 600 ~/.config/focus-tracker/swiftbar.env`.
5. Optional: `brew install terminal-notifier` for notifications that open the tracker when clicked. Without it the plugin uses AppleScript notifications.

For both modes at once, copy the plugin twice (for example `focus-work.1m.sh`) and point the copy at another file with `FT_CONFIG=~/.config/focus-tracker/swiftbar-work.env` set inside it, just below the first line.

## How it works

The server writes the plugin's whole menu (`GET /api/swiftbar`), so the script needs only `curl` and has no JSON parsing. Clicks post to `/api/swiftbar/action`. Lines starting `#notify` are turned into notifications and then marked seen on the server, so the same reminder is never shown twice, even with several Macs.
