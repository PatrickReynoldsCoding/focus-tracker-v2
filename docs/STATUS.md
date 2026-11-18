# Status

Updated 2026-11-18. Phases from the spec (`SPEC.md` §7).

| Phase | State |
|---|---|
| 0 Decisions and setup | **Done**, except the work Google account check (needs the owner). Decisions in [DECISIONS.md](DECISIONS.md). Deployed at `https://focus-tracker.focus-tracker.workers.dev`. |
| 1 Backend API and data model | **Done.** Every entity in spec §4 has a table and REST endpoints; moves, cascading deletes, server-side undo, `/api/status`. Tests. |
| 2 MCP connector | **Done.** 38 tools, OAuth for Claude's custom connectors, API tokens for Claude Code. Tested end to end (register → consent → token → tool call). Not yet tried from the real Claude app. |
| 3 Web app | **Mostly done.** Today, Projects, project page (Kanban with drag and drop, notes, criteria, resources, sessions), Notes and lists, Habits, Log, Settings; PWA. Missing: whiteboards (Excalidraw), stickies, draggable Grafana-style panels, project links UI, insights. |
| 4 Google Drive sync | Not started. Tables (`accounts`, `drive_links`) exist. Needs a Google Cloud OAuth app from the owner. |
| 5 Migration from v1 | Not started. Needs access to the v1 spreadsheets. |
| 6 Android app and widgets | Not started. |
| 7 Mac SwiftBar plugin | **Done, untested on a Mac.** Menu, click actions and notifications (reminders, habit prompts, pomodoro). |
| 8 Self-hosting | **Mostly done.** Deploy button, auto-provisioned D1/KV, self-migrating database, docs. The button needs the repository to be public. |
| 9 Stretch | Not started. |

## Waiting for the owner

1. **Try it.** Sign in at the address above (password in `.secrets.local` in the repo folder, git-ignored; change it with `npx wrangler secret put OWNER_PASSWORD`). Connect Claude ([connect-claude.md](connect-claude.md)).
2. **v1 feature audit** (spec: before Phase 3 is finished). Which v1 features are really used? Candidates to cut or defer: whiteboards, stickies, project links, draggable panels, pop-out windows, insights.
3. **Overturn any decision** in [DECISIONS.md](DECISIONS.md) you disagree with, especially D3 (one database, mode column) and D5 (Markdown notes).
4. **Work Google account**: can it authorise a third-party OAuth app? Try signing in to any small third-party app that asks for Drive access.
5. **Google Cloud project** for Drive sync: create one, an OAuth client (Web), and add the tracker's address as a redirect URI. Then Phase 4 can start.
6. **v1 data** for the importer: the Personal and Work spreadsheet ids, or an `.xlsx` export of each.
7. **Repository visibility**: public is needed for the deploy button.
8. **Android**: native Kotlin (best widgets, recommended) or cross-platform?
