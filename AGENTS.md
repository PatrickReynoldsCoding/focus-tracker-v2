# Instructions for Claude (and any other agent) working on Focus Tracker v2

Read this file, then `docs/HANDOVER-2026-11-21.md` (latest session: what is deployed and what is still to release), `docs/STATUS.md` (where the work is) and `docs/DECISIONS.md` (why it is built this way) before planning anything. The original spec is the owner's `SPEC.md` on Google Drive; v1 (`PatrickReynoldsCoding/focus-tracker`, Apps Script) is the requirements source, not code to port.

## Rules carried over from v1

- **Never link or copy sensitive material.** Only link a file the owner named. If it holds bank or card details, passwords, ID or passport numbers, tax references or health records, stop and ask. Never copy a linked file's contents into the tracker or this repository. Never commit real ids, addresses, tokens or the owner's data.
- **Check that a change is needed now.** This tracker exists to cut procrastination, so building it can become procrastination. When the owner asks for a new feature or tweak, ask once: "Are you sure you need this right now, or is it procrastination?" Fixing a bug that stops them using the tracker is not a new feature: fix it without asking.
- **Each day starts empty.** Never pick the day's focus project automatically.

## How the code is organised

Modular first: a feature lives in its own files on the server and in the browser, plugs in through a registry, and can sit behind a feature flag. Adding, removing or switching off a feature should not mean editing other features' files.

**Server** (`src/`)
- `src/index.ts`: the Worker. `OAuthProvider` in front; `/mcp` goes to `src/mcp/server.ts`, everything else to the Hono app in `src/api.ts`. Static files (the built web app in `public/`) are served by Workers Assets.
- `src/core/`: the small shared core.
  - `entity.ts`: how a table is described (fields, types, refs, ordering, hooks).
  - `store.ts`: generic create / get / list / update / remove / move for any entity, recording every change for undo; cascades deletes along `ref` fields marked `cascade`, clears the others.
  - `features.ts`: **feature flags**. A module lists the flags it reads in `Module.features` (`{ id, label, description, default, experimental? }`); the owner switches them in Settings → Features, **per profile** (D35: a request's flags are those of its mode; Claude's tool list shows a tool while it is on in any profile). Server code asks `await ctx.feature('id')`; a route that belongs to a flag calls `requireFeature(ctx, 'id')`; a Claude tool sets `feature: 'id'` and is hidden while it is off.
  - `ctx.ts`, `auth.ts`, `migrate.ts`, `registry.ts`, `ids.ts`, `errors.ts`.
- `src/modules/<feature>.ts`: one feature each. A module declares `entities` (tables), `routes` (REST routes under `/api`), `tools` (Claude tools, zod input) and `features` (flags). List it in `src/modules/index.ts` A module may also list `files` (rows the Files tab shows: `src/core/files.ts`, a `FileSource` with type, group, entity and `list(ctx, like)`, and optionally `today` (panel id prefix and how to put a file on Today or off it), which Add panel and Claude's `add_panel` use) and `fileAddons` (`FileAddon` in `src/core/files.ts`: something attached to every file that the Files listing adds to each file, searches and filters by with a query parameter; tags use it, and `FileSource.rowKind` names the kind of row a file is), and cross-cutting hooks `beforeWrite` / `afterWrite` (run for every row of every kind written through the store, in the same undo step; the files module keeps `folder_id` and `project_id` in step with them) and `beforeDelete`.
- Boards (D40): projects, to-dos (`lists.kind = 'todo'`) and plain lists are boards of one engine, `src/modules/boards.ts` (columns, cards, first column, Done column, tick, move, day; Claude's card tools). `src/modules/done-column.ts` keeps the fixed Done column (`columns.is_done`) of every project (flag `done-column`) and every to-do last and undeletable, and a card's `done` in step with being in it, for every way a card changes (D34). Code that needs "the column that means done" calls `doneColumnOf()` (or `doneColumn()` for a project) in `boards.ts`. A to-do's items are cards; `src/modules/todos.ts` keeps the old to-do API (`/api/todos`, the `todos` kind, the to-do shape) answering over them through a kind alias (`Module.aliases`, `kindOps` in `core/store.ts`): never query a `todos` table, it is gone.
- Android widget feeds (D44): `src/modules/widgets.ts` answers the Files and Single file widgets with one hand-written compound query over lists, notes, projects, whiteboards and resources (not through `FileSource.list`, to stay in the 10 ms). A new kind of file that should show on those widgets needs a part there.
- Profiles are modes (`src/modules/profiles.ts`, D35): a new per-profile setting needs nothing (settings rows are per mode); a setting for every profile uses mode `''`; a new table with a `mode` column is picked up by deleting and purging a profile (a test checks).
- `migrations/`: D1 schema. A new migration also needs a line in `MIGRATIONS` in `src/core/migrate.ts` (a test checks). Never edit a migration that has shipped; add a new one.

**Browser** (`web/src/`)
- `core/`: `api.ts` (fetch, `optimistic`, `change`, undo, toast), `offline.ts` (saved copies of GET answers and the queue of changes made offline; `api.ts` and `useData` use it, so a feature does nothing for it), `signal.ts`, `ui.tsx` (shared components), `features.ts` (flags in the browser: `useFlag(id)`), `registry.tsx` (the plug-in points).
- `features/board/` (D41): the to-do screen, one component for every board: `TodoBoard` (a to-do, a plain list, a project's board; Board and List views, flag `unified-board`), `CompactItems` / `SmallItems` (a to-do or list in a panel), `CardDialog` (its sections come from `registerPanel('card', …)`). A screen that shows a board uses these, never its own copy; changes to a board go through `features/board/actions.ts`.
- `features/<name>/`: one feature each, registering what it adds; `features/index.ts` imports each one once. Plug-in points (all take an optional `feature` flag id and an `order`):
  - `registerTab` (side bar, and the phone's bottom bar when `phone: true`, at most 5; `hideWith: '<flag>'` hides the tab while that flag is on, for a tab that takes another's place; `replaces: ['<tab id>']` hides those tabs while this one shows and makes their pages (`RouteDef.tab`) highlight this one: Files replaces Notes and Whiteboards), `registerRoute` (a page that is not a tab, such as `/p/<id>`; an old address can render a redirect with `replaceRoute(path)` from core/ui, which the Back history skips),
  - `registerFileType` (features/files lists them): a kind of file on the Files tab (`type` as the server's `FileSource`, its filter `group`, `icon(file, size)`, `href`, optional `open`, `preview`, `detail`, `rename`, `remove`, `fixed`, and `create` entries for the New menu, each a dialog given `{ folderId, onClose }` and optionally `make(name, folderId)` to make one at once; `panel(f)` gives its panel id on Today when it can be a panel). Notes, lists and to-do lists (features/notes/files.tsx), whiteboards and links register theirs; `FileGlyph` (core/ui) draws a type's tinted icon.
  - `registerFileAddon` (features/tags, D43): something attached to every file: `chips` on its Files card and row and in Add file (`<FileChips file>`), a `menu` line in its ⋯ menu with a dialog, a `header` piece on a file's own page (`<FileHeaderAddons file={{ type, id, name }}>`), a Files `filter` (a query parameter of GET /api/files and its control under the type chips).
  - `registerProjectLabel` supplies the small project label; a feature draws `<ProjectLabel projectId={…} />` (link by default, `link={false}` inside a button) and gets nothing for no project or while `project-labels` is off. Names come from one shared projects list (features/project-labels/names.ts), never a request per label.
  - `registerPanel('today', …)` gets `{ today, setToday }` (GET /api/today),
  - `registerPanel('project', …)` gets `{ project, setProject }` (GET /api/projects/:id/full),
  - `registerPanel('projects', …)` is a section of the Projects tab (under the table), gets `{ category }` (the tab's category filter),
  - `registerPanel('card', …)` is a section of the card dialog, gets `{ card, columns, save, update, close }`,
  - `registerPanel('settings', …)` is a section of Settings; give it `scope: 'profile' | 'all' | 'device'` (whom its settings are for, shown as a tag; D35 lists which setting is which),
  - `registerPanel('habits', …)` is a section at the top of the Habits tab (no props),
  - `registerOverlay` draws something over every page once signed in (gets `{ route }`), such as the session's corner timer.
  - `registerHeaderItem` puts something at the left edge of the header (gets `{ route }`), such as the Back button.
  - `registerPanel('card-tile', …)` is a small mark on a board card, gets `{ card }` (render a component, keep it tiny),
  - `registerPanel('list', …)` is a section of a list's page (under its heading), gets `{ list, setList }` (GET /api/lists/:id/full),
  - `tabBadges` (a signal) sets a small count beside a tab's name in the side bar and phone bar.
  - `registerMarkdownEditor` supplies the editor behind `MarkdownEditor` (core/ui.tsx); `features/editor` registers the rich one (flag `rich-editor`), otherwise the plain text box is used. Give `MarkdownEditor` a `note={{ kind, id }}` for a project's or list's note so it saves with conflict protection and keeps drafts.
  - A panel with `override: true` replaces another feature's panel of the same id whatever the import order (the editor's card-dialog `note` section does this).
  - `registerConflictHandler` (core/offline.ts): a change made offline that the server refuses with 409 on sending can be handled by a feature (the editor turns a note into a draft with its Keep mine / Use theirs / Keep both choice).
  - `registerPanelAdder` supplies the sheet "+ Add panel" opens (features/add-panel, flag `add-panel`); it gets a `PanelAdderTarget` from the layout (`features/layout/adding.tsx`: where things go, the panels not there yet, and how to add a file). None: the older Add panels list.
  - A panel can say more about itself: `title`, `description` and `icon` (shown by Add panel and Today settings), `alwaysShown` (cannot be removed: Today's focus card, a project's board), `fixed: 'top' | 'bottom'` (not part of the layout: drawn above or below the panels that move, such as reminder banners, the sticky-note layer and Delete project), `attachTo: '<panel id>'` (drawn straight after that panel, in its place), `kind` (`list`, `todo`, `note`, `whiteboard`, for grouping in pickers), `replaces: ['<old id>']` (takes the place of an older panel: that one is hidden while this one shows, and a saved pill, grid place or window naming it shows this one; the Today list replaces `todos`), `covers: ['<id>']` (shows that panel's content too, so Today's usual pills leave it out; it can still be added: the Today list covers `habits`), `menu(props)` (more lines for the panel's ⋯ menu on a computer, `{ label, icon?, run }`; a layout step can add them: pop-out windows add Pop out).
  - `registerPanelSource(place, …)` adds panels that come from data (each note, list and whiteboard on Today is its own panel): `Provide` returns `children(panels)`, `resolve(id)` draws one of them anywhere (a pill of Today, a window), loading its own data, and `addable()` lists what could be put on the page.
  - `registerPanelLayout({ places, component })` arranges a place's panels; layouts are chained by `order`, each calling `next(panels)` (features/layout: pop-out placeholders, then Today's pills, which choose the panels of the pill on screen and give the grid that pill's own layout through `GridScope` (`features/layout/scope.ts`), then the desktop grid, which on a narrower screen is the stack (`stack.tsx`: a long press arranges it)). Panels move and resize straight on the page; there is no Edit layout mode (D32). A new panel registered for `today` or `project` is movable, removable, addable, can be put in a pill and popped out without any change elsewhere. For the pills a panel may add `count(props)` and `compact(props)`; for windows, `oneCopy(props)` names what it edits that may be on screen only once (a note).
  - `registerPlace({ place, useProps, keyOf, label })` lets a page's panels be drawn away from the page (a pop-out window on another tab): `useProps(key)` loads their props (Today and the project page register one).
  A feature that needs a new plug-in point adds it to `core/registry.tsx` in a small, separate commit.
- React is used only by `features/whiteboards/host.ts` (Excalidraw, loaded on demand); Vite's React-to-Preact aliases are off, so never import `react` anywhere else.
- **Offline** (DECISIONS D27): change a screen's data with `useData`'s `setData` (or pass it up to the page that loaded it), not only in local state, so the saved copy keeps the change while it waits offline. A create that should work offline sends an id made with `newId()`. Which changes may wait is a list in `core/offline.ts` (`QUEUE_RULES`).
- `web/public/`: icons, manifest and the service worker `sw.js` (filled in at build time by `web/sw-plugin.ts`).
- `styles.css` holds shared tokens and base styles; a feature's own styles go in `features/<name>/<name>.css`, imported by the feature.
- `clients/swiftbar/`, `android/`: the Mac menu bar plugin and the Android app (see their READMEs).

## Adding things

- **A field**: a migration (`ALTER TABLE`), plus the field in the entity's `fields`. REST, validation, undo and Claude's generic tools pick it up.
- **A table**: a migration, an `Entity` in a module, and (if Claude should use it in a specific way) a tool.
- **A Claude tool**: add it to a module's `tools`. Describe it in one or two plain sentences; say what it changes. Every tool gets an optional `mode` argument automatically. Prefer the generic `*_item` tools for rare operations.
- **A big or debatable behaviour**: put it behind a flag, defaulting to what the owner asked for, so it can be switched back without a deploy.
- **A web view**: a folder in `web/src/features/`. Show a change on screen first and send it with `optimistic()` (rolled back with a message if refused), or `change()` when there is nothing to show first.

## Rules for the code

- Every query on mode-scoped data filters on `ctx.mode` (the store does it; hand-written SQL must too).
- Never return a secret (token, password hash): only columns described in an entity leave the database.
- Workers free plan: 10 ms CPU per request. No heavy crypto or big loops per request.
- Colours in a feature's CSS come from the tokens in `styles.css` (`var(--fg)`, `var(--surface)`, `var(--line)`, `var(--c-red)` ...), never hex or `rgb()`, so Light, Dark and E-ink (`features/theme/eink.css`) all follow. Where a colour carries meaning, E-ink needs a pattern: give the element a `c-<colour>` class or a `data-pat` attribute (see eink.css).
- Markdown is the format for notes. Never store or render HTML from a client without DOMPurify (the web app's `Markdown` component does this).
- Dates are ISO text: days `2026-11-18`, times `2026-11-18T14:05:00.000Z`. "Today" uses the owner's time zone (`ctx.today()`), not UTC.

## Checks

```sh
npm test          # builds the web app, then API, MCP, OAuth and SwiftBar tests in the Workers runtime (Miniflare)
npm run typecheck # server and web
```

For a change to the web app, also run it (`npm run build && npx wrangler dev`) and click through on a phone-sized window.

## Branches, releases and deploying

- Work on a branch per feature (`feat/<name>`), merge to `main` when its tests pass. Parallel agents each get their own git worktree and branch.
- After a merge to `main`: `npm test`, `npm run typecheck`, `npm run test:ui` against a local server, then `npm run deploy` (build, migrations, deploy to the owner's Cloudflare account) and push.
- Release often so the owner can test: bump `version` in `package.json`, tag `vX.Y.Z`, and `gh release create vX.Y.Z` with short notes of what to try. When the Android app changed, bump `versionCode`/`versionName` in `android/app/build.gradle.kts` and attach the signed APK (`cd android && ./gradlew assembleRelease`).
- **Android releases must look like this, or the app's updater will not see them** (see `android/README.md`, "Updating from inside the app"): the release is published (not a draft or pre-release); it has one asset named `focus-tracker-X.Y.Z.apk` where X.Y.Z is the app's `versionName` (not necessarily the tag: a web-only release has no APK, and the app skips it); the APK is the signed `assembleRelease` output; and the release notes contain a line of its own `versionCode: N` matching `versionCode` in `android/app/build.gradle.kts`. The notes are shown to the owner in the app. Example: `cp android/app/build/outputs/apk/release/app-release.apk /tmp/focus-tracker-0.3.0.apk && gh release create v0.6.0 /tmp/focus-tracker-0.3.0.apk --notes $'What to try...\n\nversionCode: 3'`. Check with `gh release view vX.Y.Z --json assets,body`.
- Tell the owner what was deployed and what to try.
