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
