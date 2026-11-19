# Decisions

Phase 0 asked for these to be decided. Claude made them on 2026-11-18 while the owner was busy, choosing what keeps the most options open. Each one says how to change it if the owner disagrees.

## D1. Stack: Cloudflare Workers + D1 (as the spec proposed)

Checked on 2026-11-18 against Cloudflare's pages:

| Free plan limit | Value | Our use |
|---|---|---|
| Worker requests | 100,000 a day | One person: a few thousand at most, even with a widget and the menu bar polling every minute (1,440 a day each) |
| CPU per request | 10 ms | Most requests use 1–3 ms; no heavy crypto (SHA-256 and HMAC only) |
| D1 rows read | 5 million a day | Fine |
| D1 rows written | 100,000 a day | Fine; undo history is pruned after 14 days |
| D1 storage | 5 GB | Fine (whiteboard scenes are the biggest rows) |
| KV (OAuth tokens) | 100,000 reads, 1,000 writes a day | One write per Claude token refresh |
| Cron triggers | 5 per account | We use 1 (every 5 minutes) |
| Worker size | 3 MB gzipped | About 220 KB |

Over a limit, Cloudflare stops serving until midnight UTC; it never charges on the free plan.

## D2. Code layout: small core, feature modules

- `src/core/`: entity descriptions, the generic store (create, read, update, delete, move, undo), auth, request context, migrations.
- `src/modules/<feature>.ts`: each feature declares its tables (entities), extra REST routes and Claude tools. `src/modules/index.ts` lists them; removing a line removes the feature.
- Every table is described once (`Entity` in `src/core/entity.ts`). The REST API (`/api/<kind>`), validation, undo, cascading deletes and Claude's generic tools all come from that description.

## D3. Modes: one database, a `mode` column

One D1 database. Every row that belongs to a mode has a `mode` column, and every query filters on it. Clients send the mode in the `X-Mode` header (or `?mode=`); Claude's tools take an optional `mode` argument.

Why: one deployment, one connector for Claude, one set of tokens; searching or moving things between modes stays possible later. Separate databases would double setup for self-hosters. The Drive account per mode (spec §4) is a column on `modes`, so each mode still syncs to its own Google account.

## D4. Auth: single owner

- Web app: the owner's password (Worker secret `OWNER_PASSWORD`) gives a signed, HTTP-only session cookie for 30 days. Changing the password ends every session. Changing requests from the browser must carry an `X-FT-Client` header, which a form on another site cannot send (CSRF).
- Devices (Android, SwiftBar, scripts, Claude Code): API tokens made in Settings. Only a SHA-256 hash is stored.
- Claude: OAuth 2.1 with dynamic client registration through `@cloudflare/workers-oauth-provider` (what Claude's custom connectors expect). The consent page asks for the owner's password. An API token also works on `/mcp` for clients that send a header.
- OAuth tokens only reach `/mcp`, not the REST API.

## D5. Notes are Markdown

Notes, task notes and the bodies of note-lists are stored as Markdown. Claude reads and writes Markdown well, it round-trips to Drive as `.md` files without loss, and the web app shows it formatted and edits it as text. This also settles the spec's "rich-text subset" question: the subset is whatever Markdown covers (headings, bold, italic, links, lists, checkboxes).

Open for Phase 4: whether Drive copies are `.md` files (lossless) or Google Docs (nicer in Drive, lossy). Recommendation: `.md` files, with a Google Doc export only if the owner wants to edit in Drive often.

## D6. MCP server: small, stateless, hand-written

`src/mcp/server.ts` speaks MCP over Streamable HTTP with JSON responses and no sessions, so it needs no Durable Object and fits the free plan. It negotiates the same protocol versions as the official SDK (up to 2025-11-25). Tools come from the modules. 38 tools: specific ones for the daily workflow (get_today, create_project, add_card, move_card, write_note, add_todo, log_session ...) and generic ones (`list_items`, `create_item`, `update_item`, `delete_item`, `move_item`) that work on every kind of row.

## D7. Web app: Preact + Vite, served from the Worker

About 57 KB gzipped. Phone layout first (bottom tabs, sheets for dialogs, stacked Kanban columns), then a sidebar, side-by-side Kanban and a full-width toggle from 900 px. Installable as a PWA. Changes show at once and are rolled back with a message if the server refuses.

## D8. The Mac menu bar: the server writes the menu

`GET /api/swiftbar` returns SwiftBar's text format, so the plugin is ~60 lines of shell with only `curl`, and the menu logic is tested on the server.

## D9. Ordering

Rows that can be reordered have a real-number `ord`. A move takes the midpoint between its new neighbours, so it writes one row; when gaps run out the group is renumbered.

## D10. Repository visibility

Created **private** (`PatrickReynoldsCoding/focus-tracker-v2`). The spec wants a one-click deploy for others, which needs a public repository. Making it public is the owner's call (Settings → General → Change visibility).

## D11. No Google Drive sync (owner, 2026-11-18)

Notes, lists and everything else live only in the tracker's D1 database. Phase 4 (Drive sync, multi-account Google OAuth) is dropped. Google Docs are linked from a project's or category's **resources** instead (a `docs.google.com` or `drive.google.com` address is stored with type `drive`); the link opens the Doc, the tracker never reads it, so no Google sign-in is needed.

The `accounts` and `drive_links` tables from the first migration are unused; they can be dropped in a later migration. An **export everything** button (all data in a clean format) is wanted later; it is parked in Phase 9.

## D12. No next action (owner, 2026-11-18)

Projects have no next action and the shutdown note asks only where you stopped. The fields are gone from the API, the app, the widget, the menu bar and Claude's tools. The old columns (`projects.next_action`, `projects.show_next_action`, `log.next_action`) stay in the database unused, so nothing imported is lost; a later migration can drop them.

## D13. Feature flags and plug-in points (owner, 2026-11-18)

Everything should be as modular as possible, with flags for big decisions. The server has feature flags (`src/core/features.ts`, switched in Settings → Features, one set per deployment, also hiding Claude tools), and the web app has a registry of plug-in points (`web/src/core/registry.tsx`: tabs, routes, Today panels, project panels, card-dialog sections, settings sections). See AGENTS.md "How the code is organised".

## D14. Notes and lists on Today (owner, 2026-11-18)

Any note (a list of kind note, or a project's notes) and any list can be a full panel on Today. Which ones are there is stored on the row (`lists.show_today` / `notes.show_today`) with the time they were added (`today_at`), so every device shows the same and the panels keep the order they were added. `GET /api/today-panels` returns them with their contents; `PUT /api/today-panels/show` adds or removes one; `GET /api/today-panels/available` feeds the "+ Add to Today" picker. A to-do list panel shows its open to-dos (and those done today) with tick and add; a plain list shows its items with add.

A list also stores `display` (`full` or `one`) and `seconds` (5 to 3600, default 30). "One at a time" shows a random item as a quote card in the list's colour with its note under it, shuffled with no repeats until all were shown; the browser does the timing. It sits behind the flag `list-one-at-a-time` (default on): while off, every list shows in full. The settings live on the list's page (with the linked project, `lists.project_id`); a linked list shows in full on its project's page.

Due reminders and other notifications show as banners above Today (`GET /api/today-panels/banners`, which adds the project a reminder is about). "Make it today's focus" sets the focus and dismisses; Dismiss finishes the reminder. The Today tab carries a count of them.
## Small items: redo, modes, saving indicator

- **Redo** uses the undo table. Undo sets `undone = 1` on a batch; redo takes the oldest undone batch of the mode and writes its `after` rows again. Any new change (`Ctx.flushUndo`) deletes the undone rows of that mode, so redo only works straight after undo. `POST /api/redo` and the `redo` tool; Ctrl/Cmd+Shift+Z and Ctrl+Y in the browser.
- **Modes** have an accent colour (`modes.color`, `#rrggbb`, migration 0006). The browser sets `--accent` while that mode is open. A mode can only be deleted when it has no rows in any mode-scoped table, is not the last one and is not the default. A category in use cannot be deleted; the error says how many projects, habits, backlog items and resources use it.
- **Saving indicator**: every non-GET call in `web/src/core/api.ts` counts; "Saving…" while any is in flight, then "Saved" for 3 s, or "Not saved".
- The Projects tab reopens the last project per device and mode (localStorage); "← Projects" forgets it.
## D16. Issue links, Jira style (V1-GAPS item 16, 2026-11-18)

The owner asked for typed relationships between items, like Jira, not only project links. Code: `src/modules/relations.ts` and `web/src/features/links/`; flag **`issue-links`** (on).

- **What can be linked**: projects, cards, to-dos, backlog items and lists (notes too). Each end stores its kind and id (`from_kind`, `from_id`, `to_kind`, `to_id`).
- **Database**: migration 0003 *alters* the existing `links` table (adds `from_kind` and `to_kind`, default `projects`, plus indexes) rather than making a new table. Old rows were project to project, so they keep working as they are, the REST path stays `/api/links`, and the v1 importer still fits. A unique index was left out: undo restores rows with `INSERT OR REPLACE`, which would silently drop a clashing row; the module checks duplicates itself.
- **Link types** are one table in `relations.ts` (`LINK_TYPES`), one line each with an outward and an inward phrase: blocks / is blocked by, relates to, duplicates / is duplicated by, clones / is cloned by, causes / is caused by, is parent of / is child of. Flags on a line say whether the type blocks, may not loop, or allows only one parent. An inward phrase given when linking ("is blocked by") swaps the ends, so links are always stored one way.
- **Custom link types**: the owner can add their own (two phrases) in Settings behind the flag **`custom-link-types`**, **off** by default because nobody asked for it yet. They are stored in a setting (`links.types`), cannot block, and cannot be removed while a link uses them. Changes to them are not undoable.
- **Rules**: no self-links; no second link of the same type between the same two items (either way round); no loops of `blocks` or of `parent`; one parent per item.
- **Deleting**: the store's cascade only follows `ref` fields of one kind, so modules got a `beforeDelete(ctx, entity, row)` hook (`src/core/registry.ts`, called from `store.remove`). Relations deletes an item's links through the store there, so they are in the same undo step and come back with undo, including links of cards deleted with their project. A backlog item started as a project passes its links to the new project.
- **Blocked**: an item is "Blocked by …" while an item that blocks it is unfinished. Unfinished means a project that is not done or dropped, a card not in a column called "Done", a to-do not ticked, or any backlog item. Lists have no status and never block. A blocked project is left out of Today's suggestions and the swap list; a blocked card has a ⛔ mark on the board.
- **Claude**: `link_items`, `unlink_items`, `list_links`, `list_link_types`; `get_project` has `links` (each with its phrase) and `blocked_by`.
- **Web**: "Linked items" on the project page and in the card dialog, grouped by phrase; + Link opens a dialog (phrase, search across kinds via `GET /api/links/search`, note). A linked card opens in its own card dialog on top. New plug-in point `card-tile` (marks on board cards). Nested dialogs now close one at a time on Back. The undo message for a removed link sits inside the section, because a toast cannot be tapped while a dialog is open.

## D17. Notification settings are global and applied by the server (owner asked, 2026-11-18)

Settings → Notifications: a master switch, a switch for each kind (reminders, habit prompts, daily nudge, pomodoro and session alerts), quiet hours, and "show on" for the phone, the Mac menu bar and the web app. Claude can read and change them (`get_notification_settings`, `set_notification_settings`); REST is `GET/PUT /api/notification-settings`.

- **Global, not per mode.** One JSON setting `notify` (stored with mode `''`). The switches are about the owner's devices and sleep, not about an area of life, and a per-mode master switch would be easy to forget in the mode you are not looking at. The daily nudge's hour and "untouched for N days" stay per mode (`nudge.hour`, `nudge.days`, as before) because the nudge looks at that mode's projects; the section shows them with the other controls. The older `nudge.enabled = off` still counts.
- **The server decides, so no client changes are needed.** A switched-off kind is not made (`generate`, `dailyNudge`); a notification made earlier is hidden when its kind or the master switch is off. `pendingNotifications`, which feeds `/api/notifications/pending`, `/api/status`, `/api/swiftbar` and the web banners, returns nothing during quiet hours or for a client that is switched off. Pomodoro alerts are only gated (`pomodoroNotice` is untouched); switching them off also clears any left over.
- **Quiet hours hold back delivery, they do not drop it.** Notifications stay pending and show when the window ends. The window is in the owner's time zone (`ctx.timezone()`), may cross midnight (22:00 to 07:00) and an empty window (same start and end) is refused. The raw `GET /api/notifications` list is not filtered.
- **Per client.** Clients may pass `?client=android|swiftbar|web` (`ctx.client`). `/api/swiftbar` counts as `swiftbar`; the Android app sends `client=android`; the web banners send `client=web`. A request with no client is not filtered by client (Claude, scripts).
- **No feature flag.** Everything defaults to on, which is how it behaved before.

## D18. Updating the Android app from inside the app (owner asked, 2026-11-18)

Same approach as the owner's Steady app, with plain Views. The app asks GitHub (`/repos/PatrickReynoldsCoding/focus-tracker-v2/releases`) for releases, picks the newest non-draft, non-pre-release one that carries an asset `focus-tracker-X.Y.Z.apk`, downloads it with progress, checks that it is this app, newer and signed with the same key, and installs it with `PackageInstaller` (asking once for "install unknown apps"). Data, sign-in and widgets are kept because it is an update, not a reinstall.

- **Which release.** Most releases of this repository change only the web app and carry no APK, so the app looks through recent releases for the newest one with an APK, not just `releases/latest`. The version is the APK's own (from the file name), not the tag, because the tag is the whole project's version.
- **How the app knows it is newer.** The release notes carry a line `versionCode: N`; the app compares it with its installed `versionCode`. Without the line it compares the version in the file name with its `versionName`. Either way, the downloaded file's own `versionCode` is checked again before installing.
- **Where it shows.** A native bar above the web app appears only when there is an update (Update, Release notes, Later; progress; the permission step). The web app's Settings gets an "Android app" section (version, "Check for updates") only inside the app, through a small JavaScript bridge (`window.FocusTrackerAndroid`) that can only start the same checked path. The app checks when it opens, at most every 4 hours.
- **Safety.** The release build only installs from `https://github.com/PatrickReynoldsCoding/focus-tracker-v2/releases/download/`. Debug builds can be pointed at a local test server (see android/README.md) and cannot update to a release signed with the other key.

## D19. Sessions: pause, a pomodoro that waits, planned length (V1-GAPS items 1–6, 9, 13; 2026-11-18)

- **Its own module.** Running sessions moved from `today.ts` to `src/modules/sessions.ts` (routes under `/api/session/*`, tools `start_session`, `pause_session`, `resume_session`, `stop_session`). The session is still one JSON setting per mode (`session.current`), so it follows you between devices; no migration. Sessions saved before keep working (no pauses, pomodoro from the start, no limit).
- **Time worked leaves out pauses**, and the pomodoro and the planned length run on time worked, so a pause stops both. Breaks count as time worked (v1's rule). `elapsed_seconds` in the API now means time worked (same as the new `worked_seconds`).
- **The pomodoro waits for a click** (flag `pomodoro-waits-for-click`, on). `status.session.pomodoro` keeps `phase` and `seconds_left` (0 while waiting) and adds `waiting`, `next_phase` and `paused`, so the Android widget and older menu bar plugins still read it. Notifications: one when a period ends ("Time for a break" / "Break over") and "Time is up" (kind `session`), both switched by "Pomodoro and session alerts" in notification settings. With the flag off, periods follow each other by themselves as before.
- **Planned length**: 25, 50, 90, no limit or 1–600 minutes. The length used last is one global setting (`session.length`, like v1: not per mode), 25 before anything is chosen, and also applies when Claude or the menu bar start a session without one. Keep going adds 10 or 25 minutes from now, or from the planned end if that is later.
- **On this device only** (localStorage): sounds on/off (`ft.sound`), where the app opens (`ft.openOn`, `ft.lastRoute`), the corner timer's corner and hidden state (`ft.timer.corner`, `ft.timer.hidden`), and "Show my focus anyway" on an away day (`ft.away.shown`). A sound plays once per period per device, and only when the period ended while the page was open (not when you open the app later).
- **Corner timer** (flag `corner-timer`, on): every page except Today, and hidden on the session's project page while its session panel is on screen.
- **Swap dialog**: `GET /api/focus/candidates` ranks every active project like the suggestions (today's rotation category first, least recently touched first, locked and blocked ones left out). `PUT /api/focus` and `set_focus` take `remind_in_days` (default 1; null = no reminder).

## D20. The note editor (V1-GAPS items 20, 25–28; owner, 2026-11-18)

Notes are still Markdown (D5); the editor only changes how they are edited. Code: `web/src/features/editor/`, flags `rich-editor` and `paper-themes` (both on).

- **ProseMirror, not a hand-made editor or TipTap.** v1's editor was buggy; ProseMirror is the well-maintained base most editors build on, and using it directly (no TipTap layer) is smaller. The editing part is a separate chunk (about 79 KB gzipped) loaded when the browser is idle or on the first tap, so the app's first load grew by about 3 KB of script and 2.6 KB of CSS only. The formatted view of a note is still `marked` + DOMPurify, as before.
- **Markdown in and out without loss.** Reading uses `marked` with the app's options (gfm, line breaks), so the editor shows what the view shows. Writing is our own and keeps the author's choices (`-` or `*`, `*` or `_`, fences), so opening and saving a note Claude wrote does not rewrite it; an edit changes only what was edited. Each block is read back after writing; if light escaping changed it, that block is written again with full escaping. Tables, HTML and link definitions are kept as raw Markdown blocks (shown as source; edit them with ⋯ → Edit Markdown source). Opening and closing without typing saves nothing. Tests: a corpus of realistic notes must come back byte for byte, odd Markdown must render the same, and random notes full of Markdown characters must keep their text (`test/editor-markdown.test.ts`). Known normalisations: empty paragraphs are dropped, setext headings become `#`, indented code becomes fenced, and the second of two lists in a row switches its marker (`-` to `*`) so they stay two lists.
- **Toolbar**: Text ▾ (text, headings 1–3, quote, code block), B I S, Lists ▾ (bullet, numbered, checklist, indent), Insert ▾ (link, checklist, divider, code block, inline code), undo and redo, ⋯ (Copy as Markdown, Edit Markdown source, paper, full screen). Menus work by keyboard (arrows, Home, End, Esc returns to the button), mouse and touch, and do not take the focus from the text, so a phone keyboard stays up. Keys: Ctrl/⌘+B, I, Shift+X (strike), E (code), K (link), Ctrl+Alt+0–3, Ctrl+Shift+7/8/9 (lists), Ctrl+Enter (tick), Tab/Shift+Tab, Esc (leave full screen, then stop editing). Markdown typed at the start of a line (`# `, `- `, `1. `, `[ ] `, `> `, ```` ``` ````, `---`) and around words (`**bold**`, `*italic*`, `` `code` ``, `~~strike~~`) turns into formatting. Pasted Markdown is formatted; copying from the editor gives Markdown.
- **Phone** (under 700 px): editing is full screen in the top layer (a popover, so it also sits above a card dialog), sized to `visualViewport` so the toolbar stays just above the keyboard, with Done at the top; Back leaves the editor. **Desktop**: drag (or arrow keys on) the grip under the editor to set its height, remembered per device and per place (card, project, list).
- **Saving**: after 1.2 s without typing, when you leave the editor, when the page is hidden or closed (a `keepalive` request), and when the device comes back online. A draft is kept in localStorage until the save is confirmed; if one is left over, the note shows "Unsaved changes from … on this device: Restore / Discard". Ticking a checkbox in the formatted view saves at once.
- **Conflicts**: `GET /api/notes/of/:kind/:id` returns the note with `updated_at`; `PUT` takes `base` (the `updated_at` the edit started from, or null for a new note) and answers 409 with the current note when it changed since (a save that changes nothing is allowed). Without `base` it saves as before, and Claude's `write_note` is unchanged. Card notes (`tasks.note`) are checked in the browser (read, compare `updated_at`, write), which is not atomic but is enough for one person. The editor then offers Keep mine (overwrite), Use theirs (undo brings yours back) or Keep both (theirs, a divider, then "My copy (this device, time)" and yours).
- **Paper themes** (per device, ⋯ menu): Plain, Legal pad, Grid, Dot, in light and dark. Rules line up with the text's line height.
- **Flag off** (`rich-editor`): the plain Markdown text box from before, unchanged.


## D21. Resources: icons, Drive pop-up, shared per category (V1-GAPS items 23 and 24; owner, 2026-11-18)

Code: `src/modules/resources.ts` (the table moved here from `basics.ts`), `src/core/resource-kinds.ts` (detection, shared with the browser), `web/src/features/resources/`. Setup for the optional picker: `docs/google-picker.md`.

- **Kind is stored and worked out from the address.** Migration 0010 adds `resources.kind` (doc, sheet, slides, form, drawing, folder, file, pdf, image, link, phone, email, text). The server sets it on create and again whenever the value or type changes, so Claude (`create_item`, the new `add_resource` and `add_resources`) and the app always agree. A Google address makes the type `drive`; `docs.google.com/...` without `https://` is accepted; `/u/1/`, `/a/domain/`, `open?id=` and `uc?id=` shapes are understood. A "link" that is really an email or phone number is stored as such. A `kind` sent with a Drive file address is only a hint (file, pdf, image, folder) and never overrides a Doc, Sheet, Slides, Form or Drawing. Rows made before the migration show the right icon too (the browser works the kind out when it is empty).
- **Titles cannot come from Drive** (we never read Drive, D11). A pasted address gets "Google Sheet", "Drive folder" and so on, editable before adding; a title written next to the address ("Budget - https://…", Markdown links, a line above) is used.
- **Add from Drive always works by pasting; Google's Picker is an extra** behind flag `google-picker` (off). It needs `GOOGLE_PICKER_CLIENT_ID` and `GOOGLE_PICKER_API_KEY` on the Worker (and optionally `GOOGLE_PICKER_APP_ID`); `GET /api/resources/picker` hands them to the signed-in browser only when both exist and the flag is on. The browser gets its own `drive.file` token (never sent to the server) and Google's scripts load only when the button is pressed. Not tested against real Google (no credentials).
- **Shared resources** are rows with a `category_id` and no `project_id`. They show in a "Shared resources" panel on the Projects tab (new plug-in point `registerPanel('projects', …)`, gets `{ category }`) and under the project's own list on each project page of that category.
- **Bulk add** (`POST /api/resources/bulk`) skips addresses already on the project (same Drive id counts as the same file) and is one undo step.


## D22. Habits: level history, step-up prompts, aspiring habits (V1-GAPS items 31 to 34)

Code: `src/modules/habits.ts`, `src/core/habit-levels.ts` (the maths, shared with the new-habit dialog so the preview and the server agree), `web/src/features/habits/`. v1's `docs/habits-ideas.md` §4 and "As built" are the requirements.

- **No migration.** A level stays text in the v1 style: `sessions` and `per` columns, `size` "30 min", `goal` "5 a week, 45 min". `parseLevel` and `parseSize` read them (one tested place), so the v1 importer, Claude's `update_item` and the app all write the same thing and there is one source of truth. Structured numeric columns would have meant two copies of every level. `prompts` means "on", "off" or "at goal" (as in v1).
- **The habit row is the level in force now.** Everything over time is in `habit_log`: `level` rows (day it took effect, value "3 a week, 30 min"), `pending` (a level change waiting for Accept), `answer` (yes, not now, at goal, stop asking, keep asking), `pause` / `resume`. Past weeks are compared with the level that applied then (`levelOn`, `habitProgress(day)`). A level change takes effect from the start of the current period (this Monday for weekly habits, today for daily ones); a manual edit of sessions, per or size does the same and drops a waiting change.
- **Eligibility.** A prompt is due on `habits.next_prompt`. It is shown only when about 80 % of the target sessions were done in the full Monday-to-Sunday weeks since the level last changed (at most the last 12; paused weeks and the week in progress left out; each day of a daily habit, or each week of a weekly one, counts at most its target, so one big week cannot hide an empty one). One step at a time (one more session, a longer session, or both offered with one pre-selected), never past the goal; at most one card a day; no new prompt while a change waits. Away days from the rotation are not left out (v1 did); say so if it matters.
- **Answers.** Yes makes a `pending` row due next Monday (tomorrow for daily habits); nothing else changes until the owner presses Accept on Today. "Not yet" pushes `next_prompt` by `step_up_every`; three in a row ask "Stop asking about this habit?". "I'm at my goal" sets `prompts` to "at goal" and the goal to the current level. A pending change's own "Not yet" moves it to the next Monday or tomorrow.
- **Notifications.** A habit without a goal keeps the old behaviour (a notification when `next_prompt` falls due). A habit with a goal gets one only when the prompt is earned, with the next step in it; answering the prompt dismisses it. Still behind the "habits" switch in notification settings.
- **Recording days.** Today and the 7 days before it can be changed (REST and Claude); the future and older days are refused. Progress carries `days` (the week for weekly habits, the last 7 days for daily ones) for the dots and the day strip.
- **Aspiring habits** are `status: aspiring` rows with a name and a note: never in progress, prompts or Today. Starting one is an update to `active` with a level; the hook writes its first level row and sets `started`.
- **Flag `habit-step-up`** (default on) switches the prompts, their Claude tools and the answer routes. Accepting or putting off an existing waiting change still works with it off.

## D23. Whiteboards and sticky notes (V1-GAPS items 37 and 38, 2026-11-19)

Code: `src/modules/whiteboards.ts`, `src/modules/stickies.ts` (moved out of `extras.ts` and `basics.ts`), `web/src/features/whiteboards/`, `web/src/features/stickies/`. Flags **`whiteboards`** and **`stickies`** (both on).

- **Drawings have their own table.** Migration 0012 moves `whiteboards.scene` to `whiteboard_scenes` (same id) and clears the old column, in one batch. Why: an undo row stores the whole row before and after, so renaming a board with a 1 MB drawing in the row would write 2 MB+ of undo (over D1's ~2 MB row limit), and every list of boards (`GET /api/whiteboards`, a project's page) would read every drawing. Now lists carry only the small preview; `GET /api/whiteboards/:id/scene` sends the drawing as stored (not parsed on the server, 10 ms CPU), `PUT` saves it. Old code reading `whiteboards.scene` would see nothing after the migration; the v1 importer now uses the scene route.
- **Saving a drawing is not undoable** (as in v1): the editor has its own undo, and "Close without saving" puts back the drawing as it was when the board opened, even after an autosave. Renaming, moving, Show on Today and deleting are undoable; deleting a board deletes its drawing in the same undo step, so Undo brings both back. Ctrl+Z inside a board belongs to the drawing, not to the app.
- **Size limit 1.5 MB** of JSON per drawing (checked in the browser first, then by the server with a 413 and a plain message). It leaves room for the escaped copy a delete puts in the undo history. Images pasted into a board are what makes drawings big; files no element uses are dropped on save.
- **Previews** are made in the browser on Save and close (and at most every 20 s while drawing): WebP (JPEG where WebP cannot be made) fitted into 320 × 240, smaller until under 45,000 characters; the server takes only `data:image/webp|jpeg|png;base64` up to 60,000. An imported board without a preview gets one the first time it is opened and closed, without counting as a change.
- **Where it was left**: the drawing is saved with the view's scroll, zoom and the canvas size, so it reopens at the same place, and on a screen of another size keeps the same centre. Scrolling alone is saved but does not move the board up the newest-first list.
- **Excalidraw on real React, in its own chunk.** The app stays Preact; `features/whiteboards/host.ts` is the only file that imports React, mounts Excalidraw in its own React root and is loaded with `import()` when a board opens. Vite's `preact/compat` aliases are off (`reactAliasesEnabled: false`), so do not import `react` elsewhere. Chosen over `preact/compat` because Excalidraw relies on React internals (jotai, Radix) and compat bugs would be hard to find. Excalidraw's fonts (except the 13 MB Chinese Xiaolai, which falls back to Excalidraw's CDN when such text is drawn) are copied to `/excalidraw/fonts/` at build time, so no CDN is needed. Sizes: the app's first load grew by about 7 KB gzipped of script (whiteboard lists 4, sticky notes 3) and 1 KB of CSS; opening a board fetches about 545 KB (Excalidraw and React 380 KB, its CSS 22 KB, fonts). The Mermaid and font-subsetting parts of Excalidraw are separate chunks loaded only if used.
- **Claude** gets `list_whiteboards`, `get_whiteboard` (elements shortened by default, `full` for everything, images by id only) and `create_whiteboard`, which takes simple elements (a rectangle with a `label`, an arrow with `start`/`end` ids); the app fills in the rest with Excalidraw's `convertToExcalidrawElements` when the board opens.
- **Where the tab is**: Whiteboards is in the side bar only. On a phone it is reached from the project page's Whiteboards panel ("All") and a Whiteboards link at the bottom of the Projects tab, and boards put on Today show there.
- **Sticky notes** keep v1's places, so imported notes land where they were: `x` a percentage of the project page's width, `y` pixels from its top, `w` and `h` pixels (limits 120–900 and 80–900, paper 0.4–1, v1's 15 colour names). On a narrow screen a note's left edge and width are clamped in CSS; the saved place changes only when it is moved or resized. Text saves 0.8 s after typing stops (and when the page is hidden); edits not yet confirmed are laid over reloads so older text never comes back. Hide/Show is per device (`ft.stickies.hidden`). They are a `project` panel (a layer over the page), not an overlay. Claude uses `create_item` with kind `stickies` (only `project_id` and `text` needed).

## D24. Insights replaces the Log tab (V1-GAPS items 35 and 36, 2026-11-19)

Code: `src/modules/insights.ts`, `web/src/features/insights/`, test `test/insights.test.ts`. Flag **`insights`** (on). No tables, no migration.

- **Insights takes the Log's place** (as in v1), with sub-tabs Week, Habits, Projects and Logs. The Log tab is not removed: it is registered with `hideWith: 'insights'` (a new optional field on `registerTab`), so switching the flag off brings the plain Log list back. `#/log` opens Insights on Logs. Logs keeps editing (the same edit dialog and delete as before, `/log/:id`), adds a project filter, a from/to date filter and "Show older lines", and the filter totals.
- **One call per sub-tab**, all read only and mode scoped: `GET /api/insights/week`, `/habits?weeks=8|12|…` (1 to 26), `/projects?weeks=…`, `/logs?project&from&to&limit&offset`. Focus, to-dos and skips are summed in SQL (`GROUP BY` over a date range); habit rows are read only for the range, plus the (few) level, pause and resume rows. So a call reads a few hundred rows. The page keeps the last answer per mode and path, so a sub-tab shows old numbers at once while new ones load.
- **Weeks** run Monday to Sunday in the owner's time zone (`ctx.today()`; the test checks a Sunday in UTC that is already Monday in Auckland). A habit week is compared with the level that applied then: the latest `level` row on or before the Monday (before the first row, the first row). A daily habit is judged day by day against the level of that day, and a "not today" (skip) day asks for nothing. Sessions above the target are `over` and drawn apart (hatched); `counted + over = done`.
- **"On target n of m weeks"** counts only weeks that are over, were not touched by a pause and began on or after the habit's start (a habit that began mid-week has a `partial` first week). A week is `met` when the counted sessions reach the target (the step-up prompt's 80 % rule is a different question). Weeks not over show lighter; paused weeks show a dash; no red and no "missed".
- **Projects**: aspiring or finished projects with nothing in the range are left out; an active project with nothing logged stays (it is what you want to see). A project is stale (bold "Last touched") when active and last touched more than 14 days ago (`STALE_DAYS`). Sessions without a project are one "No project" row.
- **Charts** are hand-made SVG (about 5 KB gzipped in a separate chunk, fetched when the tab is first opened) in one hue, the app's accent, so identity never depends on telling hues apart: done solid, extra hatched, target a dark line, not over lighter. Text is HTML, not SVG. Each column is focusable and tapping or hovering it shows its numbers under the chart; the legend is always shown; Habits has "Show as table". Colours are the shared tokens, so dark mode follows the app.
- **Phone**: the bottom bar already holds five tabs, so Insights is in the side bar (wide screens) and reached on a phone from a link in Settings. Putting it in the bar means dropping one of Today, Projects, Notes, Habits or Settings; the owner can choose.
- **Remembered per device** (localStorage `ft.insights.*`): the sub-tab, the Week choice, the Habits range and view, the Projects range and the Logs filters.
- **Claude** gets `insights` (`view`: week, projects or habits; `weeks`), read only, hidden while the flag is off.

## D25. The Notes tab as cards, themes, Back and swipe (V1-GAPS items 29, 43 and 44; branch feat/shell-polish)

- **Notes cards** (`web/src/features/notes/NotesTab.tsx`). A CSS grid whose cards span as many 8 px rows as they are tall (a ResizeObserver sets the spans), so the cards pack like Google Keep and the order still reads across. Drag with SortableJS (long press on touch), saved with the generic `POST /api/lists/:id/move` (`index`, among all lists); dragging is off while a search or kind filter hides cards. Project notes are an optional second block of cards below the lists: `GET/PUT /api/lists/project-notes`, a per-mode setting `notes.project_cards` (off by default; only active projects whose note has text). A to-do list's card shows its open to-dos and those ticked today (`done_today`), ticked with the same `POST /api/todos/:id/tick`, shown at once.
- **Themes** (per device, `localStorage` `ft.theme`: absent = Same as computer, else `light`, `dark`, `eink`). `web/index.html` applies it to `<html data-theme>` before the first paint; `web/src/core/theme.ts` keeps it up to date and exposes `resolvedTheme`/`useEink()`. The system dark rules apply only while no theme is chosen (`:root:not([data-theme])`), so Light and E-ink really are light on a dark computer. Feature CSS must use the tokens in `styles.css` (`--fg`, `--surface`, `--line`, `--c-*`, `--danger-fg`, `--shadow-pop`, `--backdrop` ...), never hex colours; explicit Dark used to lack the `--c-*` tints, now fixed. Whiteboards keep a white canvas in every theme (Excalidraw draws on light paper); its bar follows the tokens.
- **Mode accent colours** work in Light and Dark (on Dark the colour is mixed 45 % with white so it reads on a dark page) and are ignored in E-ink (`--accent` is forced to black there).
- **E-ink** (`web/src/features/theme/eink.css`, written for the owner's Hisense A9): white and black only; 2 px borders (3 to 4 px for dialogs and selected things); no shadows, transitions or animation (one rule with `!important`); 44 px tap targets; selected = thick border plus a tick. A colour that carries meaning is a pattern: nine 8 px tile patterns (stripes both ways, horizontal, vertical, dots, grid, cross-hatch, rings, sparse checks) as a 14 px strip on the left of a coloured card (`.c-red` ...), a band along the top of a Today panel (`data-pat-top`), the handle of a sticky note and the colour dots (`data-pat`), and the whole swatch in a colour picker. Insights bars are black, "not yet" bars dotted, "extra" hatched. Behaviour: the session clock repaints once a minute and shows minutes (the one-second loop stays but no longer updates the screen; an alert repaints at once), and a list "one at a time" does not rotate by itself (the arrows work).
- **Back button** (`features/navigation/history.ts`): the pages you came from, per mode, in `localStorage` (`ft.nav.<mode>`, 30 deep). A page change pushes the page left; arriving at the page on top of the stack (the phone's back button, a "← Projects" link) pops it instead. Back replaces the current page (`location.replace`), so it adds no browser history entry; the phone's own back button is unchanged (a dialog or the full-screen editor still closes first). Pages of a deleted project, list or whiteboard are dropped (a `GET` that answers 404, which Chrome logs as a console message) when you go back and while the stack is idle.
- **Swipe** (`features/navigation/swipe.tsx`, flag `swipe-tabs`, on): phone width only; the page (`main.content`) follows the finger, is heavy at the first and last tab, and slides out and in on a commit (30 % of the width, or a fast flick). Not started from the outer 24 px (the phone's own back gesture), inside boards, editors, dialogs, whiteboards, stickies, fields, sliders, anything scrolling sideways, or while a card is being dragged. `data-no-swipe` opts any element out. In E-ink or with `prefers-reduced-motion` the page does not move; a swipe just changes the tab.
