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

## D14. Issue links, Jira style (V1-GAPS item 16, 2026-11-18)

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
