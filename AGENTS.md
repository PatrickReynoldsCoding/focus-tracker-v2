# Instructions for Claude (and any other agent) working on Focus Tracker v2

Read this file, then `docs/STATUS.md` (where the work is) and `docs/DECISIONS.md` (why it is built this way) before planning anything. The original spec is the owner's `SPEC.md` on Google Drive; v1 (`PatrickReynoldsCoding/focus-tracker`, Apps Script) is the requirements source, not code to port.

## Rules carried over from v1

- **Never link or copy sensitive material.** Only link a file the owner named. If it holds bank or card details, passwords, ID or passport numbers, tax references or health records, stop and ask. Never copy a linked file's contents into the tracker or this repository. Never commit real ids, addresses, tokens or the owner's data.
- **Check that a change is needed now.** This tracker exists to cut procrastination, so building it can become procrastination. When the owner asks for a new feature or tweak, ask once: "Are you sure you need this right now, or is it procrastination?" Fixing a bug that stops them using the tracker is not a new feature: fix it without asking.
- **Each day starts empty.** Never pick the day's focus project automatically.

## How the code is organised

- `src/index.ts`: the Worker. `OAuthProvider` in front; `/mcp` goes to `src/mcp/server.ts`, everything else to the Hono app in `src/api.ts`. Static files (the built web app in `public/`) are served by Workers Assets.
- `src/core/`: the small shared core.
  - `entity.ts`: how a table is described (fields, types, refs, ordering, hooks).
  - `store.ts`: generic create / get / list / update / remove / move for any entity, recording every change for undo; cascades deletes along `ref` fields marked `cascade`, clears the others.
  - `ctx.ts`: one request's context: mode, time, settings, undo batch.
  - `auth.ts`, `migrate.ts`, `registry.ts`, `ids.ts`, `errors.ts`.
- `src/modules/<feature>.ts`: one feature each. A module declares `entities` (tables), `routes` (extra REST routes under `/api`) and `tools` (Claude tools, zod input). List it in `src/modules/index.ts`.
- `web/`: the web app (Preact + Vite). `npm run build` writes it to `public/` (git-ignored).
- `clients/swiftbar/`: the Mac menu bar plugin. Its menu is written by the server (`src/modules/swiftbar.ts`).
- `migrations/`: D1 schema. A new migration file also needs a line in `MIGRATIONS` in `src/core/migrate.ts` (a test checks).

## Adding things

- **A field**: a migration (`ALTER TABLE`), plus the field in the entity's `fields`. REST, validation, undo and Claude's generic tools pick it up.
- **A table**: a migration, an `Entity` in a module, and (if Claude should use it in a specific way) a tool.
- **A Claude tool**: add it to a module's `tools`. Describe it in one or two plain sentences; say what it changes. Every tool gets an optional `mode` argument automatically. Keep tool count reasonable: prefer the generic `*_item` tools for rare operations.
- **A web view**: `web/src/views/`, routed in `web/src/main.tsx`. Show a change on screen first and send it with `optimistic()` (rolled back with a message if refused), or `change()` when there is nothing to show first.

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

## Deploying

`npm run deploy` (build, migrations, deploy). The owner's deployment is `focus-tracker` on their Cloudflare account. Deploy after the tests pass and the change is committed, and tell the owner what was deployed.
