# Instructions for Claude (and any other agent) working on Focus Tracker v2

Read this file, then `docs/STATUS.md` (where the work is) and `docs/DECISIONS.md` (why it is built this way) before planning anything. The original spec is the owner's `SPEC.md` on Google Drive; v1 (`PatrickReynoldsCoding/focus-tracker`, Apps Script) is the requirements source, not code to port.

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
  - `features.ts`: **feature flags**. A module lists the flags it reads in `Module.features` (`{ id, label, description, default, experimental? }`); the owner switches them in Settings → Features (one setting for the deployment). Server code asks `await ctx.feature('id')`; a route that belongs to a flag calls `requireFeature(ctx, 'id')`; a Claude tool sets `feature: 'id'` and is hidden while it is off.
  - `ctx.ts`, `auth.ts`, `migrate.ts`, `registry.ts`, `ids.ts`, `errors.ts`.
- `src/modules/<feature>.ts`: one feature each. A module declares `entities` (tables), `routes` (REST routes under `/api`), `tools` (Claude tools, zod input) and `features` (flags). List it in `src/modules/index.ts`.
- `migrations/`: D1 schema. A new migration also needs a line in `MIGRATIONS` in `src/core/migrate.ts` (a test checks). Never edit a migration that has shipped; add a new one.

**Browser** (`web/src/`)
- `core/`: `api.ts` (fetch, `optimistic`, `change`, undo, toast), `signal.ts`, `ui.tsx` (shared components), `features.ts` (flags in the browser: `useFlag(id)`), `registry.tsx` (the plug-in points).
- `features/<name>/`: one feature each, registering what it adds; `features/index.ts` imports each one once. Plug-in points (all take an optional `feature` flag id and an `order`):
  - `registerTab` (side bar, and the phone's bottom bar when `phone: true`, at most 5), `registerRoute` (a page that is not a tab, such as `/p/<id>`),
  - `registerPanel('today', …)` gets `{ today, setToday }` (GET /api/today),
  - `registerPanel('project', …)` gets `{ project, setProject }` (GET /api/projects/:id/full),
  - `registerPanel('card', …)` is a section of the card dialog, gets `{ card, columns, save, update, close }`,
  - `registerPanel('card-tile', …)` is a small mark on a board card, gets `{ card }` (render a component, keep it tiny),
  - `registerPanel('settings', …)` is a section of Settings.
  A feature that needs a new plug-in point adds it to `core/registry.tsx` in a small, separate commit.
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
- Never return `accounts.refresh_token_enc` or any secret: only columns described in an entity leave the database.
- Workers free plan: 10 ms CPU per request. No heavy crypto or big loops per request.
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
- Tell the owner what was deployed and what to try.
