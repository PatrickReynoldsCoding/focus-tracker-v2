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

## Small items: redo, modes, saving indicator

- **Redo** uses the undo table. Undo sets `undone = 1` on a batch; redo takes the oldest undone batch of the mode and writes its `after` rows again. Any new change (`Ctx.flushUndo`) deletes the undone rows of that mode, so redo only works straight after undo. `POST /api/redo` and the `redo` tool; Ctrl/Cmd+Shift+Z and Ctrl+Y in the browser.
- **Modes** have an accent colour (`modes.color`, `#rrggbb`, migration 0006). The browser sets `--accent` while that mode is open. A mode can only be deleted when it has no rows in any mode-scoped table, is not the last one and is not the default. A category in use cannot be deleted; the error says how many projects, habits, backlog items and resources use it.
- **Saving indicator**: every non-GET call in `web/src/core/api.ts` counts; "Saving…" while any is in flight, then "Saved" for 3 s, or "Not saved".
- The Projects tab reopens the last project per device and mode (localStorage); "← Projects" forgets it.
