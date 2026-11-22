# Status

Updated 2026-11-22. Phases from the spec (`SPEC.md` §7).

| Phase | State |
|---|---|
| 0 Decisions and setup | **Done**. Decisions in [DECISIONS.md](DECISIONS.md). Deployed at `https://focus-tracker.focus-tracker.workers.dev`. |
| 1 Backend API and data model | **Done.** Every entity in spec §4 has a table and REST endpoints; moves, cascading deletes, server-side undo, `/api/status`. Tests. |
| 2 MCP connector | **Done.** 78 tools, OAuth for Claude's custom connectors, API tokens for Claude Code. Tested end to end (register → consent → token → tool call). Not yet tried from the real Claude app. |
| 3 Web app | **Done.** Today, Projects, project page (Kanban, notes, criteria, resources, sessions, issue links), Files (notes, lists, whiteboards, links in folders), Habits, Insights, Settings; PWA, offline, movable panels, Today pills (tabs on every screen), pop-out windows. |
| 4 Google Drive sync | **Dropped** by the owner (2026-11-18): notes stay in the tracker; Google Docs are linked as resources. See [DECISIONS.md D11](DECISIONS.md). |
| 5 Migration from v1 | **Done** (2026-11-18): Personal and Work imported into the live deployment, notes from the .docx exports, whiteboard drawings stored. |
| 6 Android app and widgets | **First version done** ([android/README.md](../android/README.md)): web app in a WebView, Today widget (tick, habit, start, quick add), notifications. Tested in the emulator, not yet on a phone. |
| 7 Mac SwiftBar plugin | **Done, untested on a Mac.** Menu, click actions and notifications (reminders, habit prompts, pomodoro). |
| 8 Self-hosting | **Mostly done.** Deploy button, auto-provisioned D1/KV, self-migrating database, docs. The button needs the repository to be public. |
| v1 parity, wave 1 | **Done** (v0.3.0–v0.10.0): Today panels, small items, issue links, notification settings, Android in-app updates, sessions, note editor, resources and Drive, habits. See [V1-GAPS.md](V1-GAPS.md). |
| v1 parity, wave 2 | **Done** (v0.11.0–v0.17.0): whiteboards and stickies, Insights, Notes tab extras, themes and E-ink, Back and swipe, Plan my week, exact Android alarms, cleanup, offline, movable panels, Today pills, pop-out windows. |
| Owner's fixes | v0.18.0: Today pills are tabs on every screen, grouped by default, each with its own desktop layout, plus an All pill (D29). v0.19.0: the Today list, one panel with today's habits, to-dos and cards; cards can be for a day (D30). v0.20.0: Files, one Drive-like tab with folders, search and a folder per project, in place of Notes and Whiteboards (D31). v0.21.0: no Edit layout: panels move and resize on the page (hover handles and ⋯ on a computer, a long press on a phone) (D32). v0.22.0: "+ Add panel" on Today and project pages, with Add file, a Drive-like picker, in place of lists of every note and list (D33). v0.23.0: board columns are statuses, with a fixed Done column on every project and Hide done (D34). |
| Owner's list, 21 Nov | v0.23.1 notes keep extra blank lines. v0.24.0 the Pomodoro is its own timer (breaks, long break, floating on every page, SwiftBar countdown). v0.25.0 profile dropdown with New profile (name + colour), menu bar and widgets follow the open profile, red badge and Not today in SwiftBar. v0.26.0 click a list's title for its settings; v1's quote card. v0.27.0 a habit can link to one project. v0.28.0 small versions of panels (To do today, Habits, Reminders, lists, notes), 'Waiting for you' removed, notes one shared panel. v0.29.0 sidebar hide/show, Settings sidebar and search. **Not done:** Android widgets that show any panel, and the widget timeout fix is not built or tried (no Android SDK on the Mac): build with `cd android && ./gradlew assembleRelease`, bump `versionCode`, and try it on the phone. |
| Profiles | v0.30.0: each profile has its own settings and feature switches (D35); New profile can copy another's settings; Manage profiles (rename, colour, order, default, delete with a week to restore); Settings sections say whom they are for; Claude's profile tools. |
| Owner's item, 21 Nov | v0.31.0: no "show on Today" switches anywhere (note, list, project notes, whiteboard, Notes tab's Project notes); + Add panel → Add file puts a file on Today and Remove takes it off (D36). |
| Owner's item, 21 Nov (2) | v0.32.0: project labels: a small coloured label with the project's name on files (Files, Add file), notes, lists and whiteboards on Today and on their pages, and Today's to-dos and cards; tap to open the project (D37). |
| Owner's item, 21 Nov (3) | v0.32.1: project label layout: on a Files card it sits in the footer, not over the preview; a whiteboard's bar on a phone has two rows so its name has room. |
| Owner's item, 21 Nov (4) | v0.33.0: Today pills on a computer are a flag (`desktop-pills`, off): a computer shows every panel in the All layout with no pill row; the phone keeps its pills (D38). |
| Owner's item, 21 Nov (5) | v0.33.1: the small note keeps its line breaks and blank lines and scrolls in a box of its own instead of growing; Files card previews keep them too (D39). |
| Owner's item, 22 Nov | v0.34.0: lists, to-dos and projects are one board engine, stage 1 (data and server): to-dos are cards with a fixed Done column, a list can become a to-do (one way, `convert_list_to_todo`), the old to-do API and every screen unchanged (D40). Stage 2 (one screen with Board and List views, dragging between groups, Convert) is next. |
| Owner's item, 22 Nov (2) | v0.35.0: stage 2: one to-do screen for to-dos, plain lists and project boards, with Board and List views (remembered per device), tick into Done, drag between groups, Convert to to-do on a plain list, no days on plain lists; flag `unified-board` (D41). |
| Owner's item, 22 Nov (3) | v0.36.0: category buttons on the Projects tab (design B), flag `category-buttons`, off by default, per profile (D42). |
| 9 Stretch | Parked: **export all data** button (wanted later), Work-mode PRs tab, fitness view. |

## Waiting for the owner

1. **Try it.** Sign in at the address above (password in `.secrets.local` in the repo folder, git-ignored; change it with `npx wrangler secret put OWNER_PASSWORD`). Connect Claude ([connect-claude.md](connect-claude.md)).
2. **v1 feature audit**: mark each row of [V1-GAPS.md](V1-GAPS.md) keep, later or cut.
3. **Overturn any decision** in [DECISIONS.md](DECISIONS.md) you disagree with, especially D3 (one database, mode column) and D5 (Markdown notes).
6. **Android**: I went with native Kotlin for the widgets and the web app for the screens. Install `android/focus-tracker-0.1.0.apk` and say what the widget should show differently.
