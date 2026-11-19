# Status

Updated 2026-11-19. Phases from the spec (`SPEC.md` §7).

| Phase | State |
|---|---|
| 0 Decisions and setup | **Done**. Decisions in [DECISIONS.md](DECISIONS.md). Deployed at `https://focus-tracker.focus-tracker.workers.dev`. |
| 1 Backend API and data model | **Done.** Every entity in spec §4 has a table and REST endpoints; moves, cascading deletes, server-side undo, `/api/status`. Tests. |
| 2 MCP connector | **Done.** 38 tools, OAuth for Claude's custom connectors, API tokens for Claude Code. Tested end to end (register → consent → token → tool call). Not yet tried from the real Claude app. |
| 3 Web app | **Done.** Today, Projects, project page (Kanban, notes, criteria, resources, sessions, issue links), Notes and lists, Habits, Whiteboards, Insights, Settings; PWA, offline, movable panels, Today pills, pop-out windows. |
| 4 Google Drive sync | **Dropped** by the owner (2026-11-18): notes stay in the tracker; Google Docs are linked as resources. See [DECISIONS.md D11](DECISIONS.md). |
| 5 Migration from v1 | **Done** (2026-11-18): Personal and Work imported into the live deployment, notes from the .docx exports, whiteboard drawings stored. |
| 6 Android app and widgets | **First version done** ([android/README.md](../android/README.md)): web app in a WebView, Today widget (tick, habit, start, quick add), notifications. Tested in the emulator, not yet on a phone. |
| 7 Mac SwiftBar plugin | **Done, untested on a Mac.** Menu, click actions and notifications (reminders, habit prompts, pomodoro). |
| 8 Self-hosting | **Mostly done.** Deploy button, auto-provisioned D1/KV, self-migrating database, docs. The button needs the repository to be public. |
| v1 parity, wave 1 | **Done** (v0.3.0–v0.10.0): Today panels, small items, issue links, notification settings, Android in-app updates, sessions, note editor, resources and Drive, habits. See [V1-GAPS.md](V1-GAPS.md). |
| v1 parity, wave 2 | **Done** (v0.11.0–v0.17.0): whiteboards and stickies, Insights, Notes tab extras, themes and E-ink, Back and swipe, Plan my week, exact Android alarms, cleanup, offline, movable panels, Today pills, pop-out windows. |
| 9 Stretch | Parked: **export all data** button (wanted later), Work-mode PRs tab, fitness view. |

## Waiting for the owner

1. **Try it.** Sign in at the address above (password in `.secrets.local` in the repo folder, git-ignored; change it with `npx wrangler secret put OWNER_PASSWORD`). Connect Claude ([connect-claude.md](connect-claude.md)).
2. **v1 feature audit**: mark each row of [V1-GAPS.md](V1-GAPS.md) keep, later or cut.
3. **Overturn any decision** in [DECISIONS.md](DECISIONS.md) you disagree with, especially D3 (one database, mode column) and D5 (Markdown notes).
6. **Android**: I went with native Kotlin for the widgets and the web app for the screens. Install `android/focus-tracker-0.1.0.apk` and say what the widget should show differently.
