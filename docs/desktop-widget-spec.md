# Spec: Desktop widget window for Linux (GNOME)

Status: **built** (part 1: v0.52.0, D64; parts 2 and 3: `clients/gnome/`, installed with `clients/gnome/install.sh`; the owner chose: follow the open profile, clickable, the Desktop has its own panels). Written 2026-11-23 for another Claude to build. The owner asked for it.
Read `AGENTS.md` first (it has the rules for code, flags, tests and releases).

## Goal

The owner's Linux laptop (Ubuntu, GNOME Shell 50, **Wayland**, one 3360×2100 screen) shows Focus Tracker
all the time, like a desktop widget: a window that sits on the left of the screen, **behind** the other
windows, and holds **any panels** the owner picks, the same panels as Today and project pages.

The owner said: "The design is pages and the ability to add any panels. Why can't the widget be a window
that we can add multiple panels to."

## The 3 parts

Build and release them in this order. Each part is its own branch and version.

### Part 1: the Desktop page in the web app (most of the work)

- A new page at `/desktop` (`registerRoute`, not a tab). Behind a new flag `desktop-page` (default on).
- It has its **own panel layout**, kept apart from Today's. Add, move, resize and remove panels work the
  same way they do on Today: "+ Add panel" (`registerPanelAdder`), grid moves, ⋯ menu.
- **Every Today panel** can go on it, including file panels (notes, lists, to-dos, whiteboards from
  `registerPanelSource`). Project panels (one project's board, notes and so on) are a nice-to-have:
  do them only if it is cheap.
- **A bare look**: no side bar, no header, no phone bar, no pills, no corner timer or pop-out
  windows. Only the panels, with a small ⚙ or + in a corner to add panels. The background follows the
  theme tokens (`var(--bg)` and the others).
- It must work in a narrow, tall window (about 500–700 px wide): one column. The stack layout
  (`features/layout/stack.tsx`) may already do this below 760 px. Check it.
- It follows the open profile like the rest of the app. Choosing a fixed profile for the desktop is a
  nice-to-have.
- Claude's layout tools (`get_page_layout`, `set_page_layout`, `add_panel`, `remove_panel`) should
  accept the desktop page, so the owner can say "add my Groceries list to the desktop widget".

**Where to start (checked 2026-11-23, verify before relying on it):**
- Layouts are settings rows `layout.<page>` per mode (`src/modules/layout.ts`). The page name only has
  to match `^[a-z][a-z0-9-]{0,30}$`, so `layout.desktop` may need no server change. Check the routes and
  tools for a list of allowed pages.
- In the browser, a layout is keyed by **place** (`web/src/features/layout/store.ts`,
  `GET /api/layout/<place>`), and panels are registered per place (`registerPanel('today', …)`).
  The likely route: the Desktop page draws the `today` place's panels with Today's props
  (`registerPlace` in `web/src/features/today/Today.tsx:233` shows how to load them away from Today),
  but reads and writes its grid under `desktop`. Look at `GridScope` (`features/layout/scope.ts`), which
  pills already use to give the grid a different store.
- If a new plug-in point is needed, add it to `core/registry.tsx` in a small separate commit (AGENTS.md).
- Write a decision `D64` (or the next free number) in `docs/DECISIONS.md`.

**Done when:** tests and typecheck pass, there is a browser check in `scripts/ui/` for the page (add a
panel, move it, reload, still there, narrow window), and the version is deployed and released.

### Part 2: open the Desktop page as its own window

- The owner already has Focus Tracker installed as a Chrome app (Chrome profile "Profile 2").
  The simplest window: `google-chrome "--profile-directory=Profile 2" --app=<tracker URL>/desktop`. It is
  already signed in, so it needs no token.
- Give the window a fixed WM class so GNOME (part 3) can find it. Chrome's `--class=` is ignored on
  Wayland, so check what `app_id` the window gets (for example with Looking Glass, `lg`, in GNOME), or match on
  the window title. Make the page's `<title>` something stable, such as "Focus Tracker Desktop".
- Add `clients/gnome/focus-tracker-desktop.desktop`, a launcher that opens it.

### Part 3: a small GNOME Shell extension that pins the window

Wayland does not let an app place itself or stay below other windows, so a GNOME Shell extension does it.
Put it in `clients/gnome/extension/` (uuid such as `focus-tracker-desktop@focus-tracker`), GJS, for GNOME
Shell 50.

When the Desktop window appears (match on app id or title), the extension:
- moves it to the left of the screen, full height, at a width the owner can change in the extension's
  settings (default 600 px);
- keeps it **below** all other windows (the way the `ding@rastersoft.com` extension pins its desktop
  window; that extension is installed on the owner's machine, so read its code);
- hides it from the dock, Alt+Tab and the overview;
- shows it on every workspace;
- opens it at login if it is not open.

Also write `clients/gnome/README.md`: how to install it (copy to
`~/.local/share/gnome-shell/extensions/`, log out and in, `gnome-extensions enable …`) and how to remove it.
Test it with a nested shell first (`dbus-run-session gnome-shell --devkit --wayland` on GNOME 50) so a
mistake cannot break the owner's session.

## Not in scope

- A native GNOME widget made of St actors that draws panels itself: that would mean building every panel
  twice. The web page reuses them all.
- Other desktops (KDE, X11), macOS, Windows.
- Android widget changes.

## Open questions for the owner (ask before building, one at a time)

1. Does the Desktop page follow the open profile, or always show one chosen profile?
2. Should the window be click-through or fully clickable? (Clickable is assumed: tick to-dos, start sessions.)
