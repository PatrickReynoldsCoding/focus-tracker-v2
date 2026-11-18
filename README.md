# Focus Tracker v2

A personal tracker for doing one thing at a time: a focus project for the day, work sessions with a pomodoro timer and a shutdown note, Kanban boards per project, notes, lists, to-dos and habits. It runs free on Cloudflare (Workers + D1), and **Claude can read and change everything through the tracker's own MCP connector**.

Clients, all on one API:

- **Web app** (phone first, installable): Today, Projects, a project's board, notes, criteria and resources, Notes and lists, Habits, Log, Settings.
- **Claude**: a custom connector at `https://<your-tracker>/mcp` with 38 tools ([docs/connect-claude.md](docs/connect-claude.md)).
- **Mac menu bar**: a SwiftBar plugin with the focus, session timer, to-dos, habits and notifications ([clients/swiftbar](clients/swiftbar/README.md)).
- Planned: Android app with home-screen widgets, Google Drive sync. See [docs/STATUS.md](docs/STATUS.md).

## Run your own

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/PatrickReynoldsCoding/focus-tracker-v2)

Or from a terminal, with a free Cloudflare account: [docs/self-hosting.md](docs/self-hosting.md). In short:

```sh
npm install
npx wrangler login
npm run deploy                       # builds, creates the database, deploys
npx wrangler secret put OWNER_PASSWORD
npx wrangler secret put SESSION_SECRET   # 32+ random characters
```

## Develop

```sh
npm install
cp .dev.vars.example .dev.vars   # fill in a password and a secret
npm run build && npx wrangler dev    # http://localhost:8787
npm run dev:web                      # optional: Vite with hot reload on :5173, API proxied to :8787
npm test                             # API, MCP and OAuth tests in the Workers runtime
npm run typecheck
```

How the code is organised and the rules for changing it: [AGENTS.md](AGENTS.md). Why it is built this way: [docs/DECISIONS.md](docs/DECISIONS.md).

## Licence

MIT
