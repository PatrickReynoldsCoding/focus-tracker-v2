# Focus Tracker on the GNOME desktop

Focus Tracker's Desktop page (`#/desktop`, DECISIONS D64) in a window of its own, for a window that
stays on screen all day. Spec: `docs/desktop-widget-spec.md`.

## The launcher (part 2)

`focus-tracker-desktop.desktop` opens the Desktop page as a Chrome app window (no tabs or address
bar) in the Chrome profile that is signed in to the tracker, so it needs no token.

Install it (and its icon) for your user:

```sh
clients/gnome/install.sh
```

Then open **Focus Tracker Desktop** from the app grid, or run `gtk-launch focus-tracker-desktop`.

- `FT_URL` sets another address (self-hosting), for example
  `FT_URL=https://tracker.example.com clients/gnome/install.sh`. The default is the owner's Worker.
- `FT_CHROME_PROFILE` sets another Chrome profile (the folder name in `~/.config/google-chrome`,
  such as `Default`). The default is `Profile 2`.
- Remove it with `clients/gnome/install.sh --remove`.

### Finding the window

The page sets the window title to **Focus Tracker Desktop** (`TITLE` in
`web/src/features/desktop/Desktop.tsx`), so the GNOME extension (part 3) finds the window by its
title. Chrome ignores `--class=` on Wayland; an `--app=` window gets an app id made from the address
(likely `chrome-focus-tracker.focus-tracker.workers.dev__-Profile_2`; not checked, GNOME does not let a
script list windows), and any other `--app=` window of the site would share it, so the title is the
reliable match. Before you are signed in the title is the
app's usual one.
