# Focus Tracker v2

A personal tracker for doing one thing at a time: a focus project for the day, work sessions with a pomodoro timer and a shutdown note, Kanban boards per project, notes, lists, to-dos and habits. It runs free on Cloudflare (Workers + D1), and **Claude can read and change everything through the tracker's own MCP connector**.

Clients, all on one API:

- **Web app** (phone first, installable): Today, Projects, a project's board, notes, criteria and resources, Notes and lists, Habits, Log, Settings.
- **Claude**: a custom connector at `https://<your-tracker>/mcp` with 38 tools ([docs/connect-claude.md](docs/connect-claude.md)).
- **Mac menu bar**: a SwiftBar plugin with the focus, session timer, to-dos, habits and notifications ([clients/swiftbar](clients/swiftbar/README.md)).
- **Android**: the app plus a Today widget and notifications ([android](android/README.md)).
- **Moving from v1**: [docs/migrate-from-v1.md](docs/migrate-from-v1.md).
- Google Docs are linked from a project's resources; notes themselves live in the tracker. Planned later: an export-everything button. See [docs/STATUS.md](docs/STATUS.md).

## Set it up from scratch

A guide for someone who has never used Cloudflare, Node or git. Take your time: each step says what you should see.

- [1. What this is and what it costs](#1-what-this-is-and-what-it-costs)
- [2. The easy way: the Deploy button](#2-the-easy-way-the-deploy-button)
- [3. The manual way: from a terminal](#3-the-manual-way-from-a-terminal)
- [4. On your phone](#4-on-your-phone)
- [5. The Mac menu bar](#5-the-mac-menu-bar)
- [6. Connect Claude](#6-connect-claude)
- [7. First-run tour](#7-first-run-tour)
- [8. Moving over from v1](#8-moving-over-from-v1)
- [9. Updating, backing up and fixing problems](#9-updating-backing-up-and-fixing-problems)

### 1. What this is and what it costs

Focus Tracker is your own private tracker. You pick one focus project a day, run work sessions with a pomodoro timer, and keep Kanban boards, notes, lists, to-dos and habits. It is a website that you own: only you can sign in, and your data lives in your own Cloudflare account.

**Cloudflare** is a company that runs websites for you. This app runs on Cloudflare **Workers** (the code) and **D1** (a small database), plus **KV** (a small key-value store). It all fits Cloudflare's free plan, so it costs nothing for one person. You do not need a credit card to make a free account. You do not need Google Cloud either. Google is only used if you choose the optional Drive picker ([docs/google-picker.md](docs/google-picker.md)).

You will end up with an address like `https://focus-tracker.<your-subdomain>.workers.dev`. Pick **one** way in: the Deploy button (section 2, the easiest) or a terminal (section 3).

### 2. The easy way: the Deploy button

You need a free Cloudflare account and a free GitHub account. The button copies this project into your GitHub account and puts it on Cloudflare.

1. Make a Cloudflare account at <https://dash.cloudflare.com/sign-up>. Confirm your email when it asks.
2. Make a GitHub account at <https://github.com/signup> if you do not have one.
3. Press this button:

   [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/PatrickReynoldsCoding/focus-tracker-v2)

4. Follow the page. Let it connect to your GitHub account. It copies the project to your account and makes the database (D1) and the key-value store (KV) for you. If it asks for a build or deploy command, use `npm run deploy`.
5. When it asks for secrets (private settings), fill in two:
   - `OWNER_PASSWORD`: the password you will type to sign in. Choose a long one and keep it in a password manager.
   - `SESSION_SECRET`: at least 32 random characters. It signs your sign-in cookie, and you never type it again. Your password manager can make one. On a Mac or Linux, `openssl rand -base64 32` prints one.
6. Wait for it to say the deploy worked, then open the `https://focus-tracker.<your-subdomain>.workers.dev` address it shows.

**What you should see:** a sign-in page. Type your password. The first request sets up the database by itself, so the first load can take a few seconds. After that you land on **Today**.

If you see "This tracker is not set up yet", the two secrets are missing. Set them as in section 3, step 6.

### 3. The manual way: from a terminal

A terminal is a window where you type commands. On a Mac open **Terminal**. On Windows use **PowerShell** (or WSL). On Linux use your terminal app. Copy each command, paste it, press Enter, and wait for it to finish.

1. **Install Node 22.** Node runs the build tools. Get it from <https://nodejs.org> (choose the 22 LTS version) and install it. Check it:

   ```sh
   node -v
   ```

   You should see `v22.` and some numbers. Version 20 or newer is the minimum, but 22 is what this was tried with.
2. **Install git.** git downloads code. Get it from <https://git-scm.com/downloads>. Check it with `git --version`.
3. **Make a free Cloudflare account** at <https://dash.cloudflare.com/sign-up> (see section 2, step 1).
4. **Download the code and install what it needs:**

   ```sh
   git clone https://github.com/PatrickReynoldsCoding/focus-tracker-v2 focus-tracker
   cd focus-tracker
   npm install
   ```

   `npm` came with Node. `npm install` downloads the project's building blocks, which takes a minute or two. You should see "added ... packages" and no red errors. If an older npm stops with an `ERESOLVE` error, run `npm install --legacy-peer-deps` instead.
5. **Sign in to Cloudflare:**

   ```sh
   npx wrangler login
   ```

   Wrangler is Cloudflare's command line tool. A browser tab opens: press **Allow**. The terminal then says you are logged in.
6. **Deploy:**

   ```sh
   npm run deploy
   ```

   This builds the web app, creates the database and key-value store the first time, sets up the database tables and uploads the app. It ends with a line giving your address, like `https://focus-tracker.<your-subdomain>.workers.dev`. The first time, wrangler may ask you to choose a `workers.dev` name for your account: pick one you like.
7. **Set your two secrets** (see section 2, step 5 for what they are). Each command asks you to type or paste the value, which stays hidden:

   ```sh
   npx wrangler secret put OWNER_PASSWORD
   npx wrangler secret put SESSION_SECRET
   ```

   After each one you should see "Success! Uploaded secret ...".
8. **Sign in.** Open your address in a browser and type your password. You land on **Today**.

Your time zone is set in **Settings → General** (the default is Europe/London). "Today" follows it, so change it first if you live elsewhere.

### 4. On your phone

**As an installed web app** (any phone):

1. Open your tracker address in Chrome (Android) or Safari (iPhone) and sign in.
2. Android: open the menu and choose **Add to Home screen** (or **Install app**). iPhone: press **Share**, then **Add to Home Screen**.
3. Open it from the new icon. It opens full screen.

**As the Android app** (adds home-screen widgets and notifications):

1. On your phone, open <https://github.com/PatrickReynoldsCoding/focus-tracker-v2/releases> and find the newest release called **Android x.y.z**. Download the file `focus-tracker-x.y.z.apk` from its Assets.
2. Open the downloaded file. Android asks to allow installs from this source (your browser or Files app). This is the **Install unknown apps** setting: press **Settings**, switch on **Allow from this source**, go back, and press **Install**.
3. Open the app. Type your tracker address (`https://focus-tracker.<your-subdomain>.workers.dev`) and your password, and choose which profile the widget shows. The app makes an API token called "Android (your phone model)" for itself. You can revoke it in **Settings → Devices and API tokens**.
4. **Updates:** the app checks GitHub when you open it. When there is a new version a bar appears: press **Update**. The first time, Android asks you to allow Focus to install apps. You can also use **Settings → Android app → Check for updates** inside the app.
5. **Widgets:** long-press the home screen, choose **Widgets**, find **Focus** and add one:
   - **Focus today**: the focus project, the timer and today's list. Tick things off, start a session, or press + to add a to-do.
   - **Focus files**: a scrolling list of notes, lists and to-dos from a folder, a tag or everything.
   - **Focus file**: one note, list or to-do.

   The Files and Single file widgets open a settings screen when you add them (profile, what to show, length, order). More: [android/README.md](android/README.md).

### 5. The Mac menu bar

An optional plugin shows your focus project and session timer in the Mac menu bar. It needs [Homebrew](https://brew.sh) (a Mac app installer).

1. Install SwiftBar: `brew install swiftbar`. Open it and choose a plugin folder.
2. Copy `clients/swiftbar/focus-tracker.5s.sh` from this project into that folder, then make it runnable: `chmod +x focus-tracker.5s.sh`.
3. In the tracker open **Settings → Devices and API tokens**, add a token called "Mac menu bar" and copy it.
4. Make the file `~/.config/focus-tracker/swiftbar.env` with these lines (your own address and token), then lock it with `chmod 600 ~/.config/focus-tracker/swiftbar.env`:

   ```sh
   FT_URL=https://focus-tracker.<your-subdomain>.workers.dev
   FT_TOKEN=ft_...
   ```

**What you should see:** your focus project in the menu bar within a few seconds. Full details: [clients/swiftbar/README.md](clients/swiftbar/README.md).

### 6. Connect Claude

Claude can then read and change everything in your tracker, and every change can be undone.

1. In Claude, open **Settings → Connectors → Add custom connector**.
2. Name: `Focus Tracker`. URL: `https://focus-tracker.<your-subdomain>.workers.dev/mcp` (note the `/mcp` at the end). Leave the OAuth fields empty.
3. Press **Connect**. A Focus Tracker page opens. Type your password and press **Allow**.
4. Ask Claude "What's on today?".

To cut Claude off, press **Disconnect** in the tracker's **Settings → Claude and other connected apps**. For Claude Code and more things to ask: [docs/connect-claude.md](docs/connect-claude.md).

### 7. First-run tour

- **Profiles** keep areas of life apart, for example Personal and Work. Each has its own projects, files, habits and settings. The dropdown at the top switches between them. **New profile...** makes one (name and colour), and **Manage profiles...** renames, reorders, sets the default and deletes (a deleted profile can be restored for 7 days).
- **Projects:** open the Projects tab and make your first project. A project has a Kanban board (columns are statuses, with a fixed Done column), notes, done criteria and resources such as links to Google Docs.
- **Today** is your day. Choose a focus project (the day starts empty until you do), and start a session with the pomodoro timer. Panels such as the Today list (habits, to-dos and cards for today) and reminders sit below. **Pills** are the tabs under the focus card. Each pill holds a group of panels. On a phone they are on by default. On a computer they are off by default and you see every panel (turn on "Today pills on a computer" in Settings → Features). Press the cog at the end of the pill row to change them.
- **+ Add panel** on Today and on a project page puts something there. **Add file** picks a note, list or whiteboard, or makes a new one.
- **Files** is a Drive-like tab for notes, lists, to-do lists, whiteboards and links, in folders, with search. Each project also gets its own folder. **Tags** can go on any file (the tag editor is in a file's ⋯ menu), and the Files tab can filter by tag.
- **To-dos, lists and boards** share one screen with Board and List views. A to-do has a Done column and ticks into it. A plain list has no ticks and no days. A list can be converted to a to-do.
- **Habits:** make a habit, count a session when you do it, and see it on Today. A habit can link to one project.
- **Settings:** each section has a tag saying whom it is for. **Features** holds the feature switches: turn parts of the app on or off (for example Habits or Insights), per profile. Many sections (Features, Notifications, Pomodoro, Link types, Today settings) offer "this profile only | All profiles", so you can set something once for every profile or give one profile its own value. **General** (time zone) is for all profiles. **Devices and API tokens** makes tokens for phones, Macs and scripts.

### 8. Moving over from v1

Only if you used the older Google-Sheets-based Focus Tracker. Export its spreadsheet, make an API token, and run `npm run import:v1` (use `--dry-run` first). It is safe to run again. Steps: [docs/migrate-from-v1.md](docs/migrate-from-v1.md).

### 9. Updating, backing up and fixing problems

**Update to a new version.**

- Deploy button: Cloudflare made a copy of the project in your GitHub account. On GitHub, open that copy and press **Sync fork** (if it shows), then it redeploys on its own.
- Terminal: in your `focus-tracker` folder run

  ```sh
  git pull
  npm install
  npm run deploy
  ```

  `npm run deploy` also updates the database for you. Your data is kept.

**Back up.** This writes the whole database to one file:

```sh
npx wrangler d1 export focus-tracker --remote --output backup.sql
```

Do it before an update that matters. D1 also keeps 30 days of history (`npx wrangler d1 time-travel`).

**Change the password.** `npx wrangler secret put OWNER_PASSWORD`. Web sign-ins end. Claude and API tokens keep working (revoke tokens in Settings).

**Problems**

| What you see | What to do |
| --- | --- |
| `npx wrangler login` opens nothing or fails | Copy the address it prints into a browser by hand, press **Allow**, then run the command again. On a computer with no browser, use an API token: set `CLOUDFLARE_API_TOKEN` (made in the Cloudflare dashboard under My Profile, API Tokens). |
| `npm install` stops with `ERESOLVE` | Run `npm install --legacy-peer-deps`. Also check `node -v` says 20 or newer. |
| "This tracker is not set up yet" | `OWNER_PASSWORD` or `SESSION_SECRET` is missing, or `SESSION_SECRET` is under 32 characters. Run the two `wrangler secret put` commands in section 3. |
| I forgot my password | Run `npx wrangler secret put OWNER_PASSWORD` in your `focus-tracker` folder and type a new one. Your data is untouched. |
| The site shows nothing or a blank page | Press a hard refresh (Ctrl+Shift+R, or Cmd+Shift+R on a Mac). If you use the installed app, close and reopen it. Then check the address is right and that `npm run deploy` finished with no errors. |
| A deploy fails on a migration (database update) | Run `npx wrangler d1 migrations apply DB --remote` to see the error, then `npm run deploy` again. Take a backup first. |
| Not sure what is wrong | `npx wrangler tail` shows the live log of your tracker while you reload the page. |

More detail: [docs/self-hosting.md](docs/self-hosting.md).

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
