# v1 features missing from v2

Compared on 2026-11-18 from v1's `docs/ROADMAP.md` and modules. Size: S under an hour, M a few hours, L a day or more. For the owner's audit: mark each keep, later or cut.

## Today and sessions

| # | Feature in v1 | v2 now | Size |
|---|---|---|---|
| 1 | Pause / resume a session (paused time not counted) | No pause | S |
| 2 | Pomodoro waits for a click ("Start break" / "Start work"), on/off per session, sounds (chicken, steam whistle), blinking tab title | Cycles by itself; on/off only in Settings; no sound in the web app | M |
| 3 | Planned session length (25, 50, 90, custom) with "Time is up", Finish or Keep going +10 / +25 | None | M |
| 4 | Corner timer on every page, draggable to a corner | Timer only on Today | S |
| 5 | Session panel at the top of the focus project's page | None | S |
| 6 | Swap dialog ranked like Today, with a reminder choice (tomorrow, 3 days, next week, none) | Plain project list; reminder always tomorrow | S |
| 7 | "Skipped N times" on the project page | Skips stored, not shown | S |
| 8 | Due reminders as banners on Today ("Make it today's focus" / Dismiss) | Reminders reach the widget and menu bar, not the web app | S |
| 9 | Away day: calm panel with "Show my focus anyway" | Away only empties the suggestions | S |
| 10 | Plan my week: plan habit sessions per day, put to-dos on days, focus lead per day, this or next week | None | L |
| 11 | Today's own running note on Today | A note can be put on Today as a link chip only | S |
| 12 | Lists shown on Today as full panels; "one at a time" rotating quote card | Lists are link chips on Today | M |
| 13 | Opens on the focus project during a session; "When the app opens" setting; remembers the last page | Always opens on Today | S |

## Projects

| # | Feature in v1 | v2 now | Size |
|---|---|---|---|
| 14 | Locks: lock a project until a date, lock notice hides its page, no sessions, two warnings to lift a lock early | `locked_until` stored and used for suggestions only; no UI | M |
| 15 | Project settings menu: show or hide the next action per project | Stored and respected; no UI to change it | S |
| 16 | Linked projects (blocks / relates) in the project's top panel, refusing loops; a blocked project is left out of the focus pick | API only (no loop check, not used by Today) | M |
| 17 | Projects tab reopens the last opened project | Always the list | S |
| 18 | "+ New category…" in the project form; a category in use cannot be deleted | Categories only in Settings; delete clears it from projects | S |
| 19 | Web addresses clickable in card titles, next actions, log and notes | Only inside formatted Markdown | S |

## Boards, cards, criteria, resources

| # | Feature in v1 | v2 now | Size |
|---|---|---|---|
| 20 | Card note with a formatting toolbar (headings, bold, italic, underline, strike, lists, colours, highlights) and shortcuts (Ctrl+Alt+1–3, `- `, `# ` as you type) | Markdown text box with preview | M |
| 21 | First lines of a card's note shown on the card | A ¶ mark only | S |
| 22 | Criteria: edit in place, drag to reorder, "Hide checked" | Add, tick, delete | S |
| 23 | Resources: edit dialog, type picker (link, Drive, phone, email, text), groups as headings, Copy buttons | Add (type guessed) and delete; groups not shown | M |
| 24 | Shared resources per category on the Projects tab | API only, no UI | S |

## Notes

| # | Feature in v1 | v2 now | Size |
|---|---|---|---|
| 25 | Rich notes editor with toolbar, Undo / Redo, heading keys | Markdown text box (tap to edit, formatted when not editing) | M |
| 26 | Full-screen notes editor on a phone, resizable height on a desktop | Grows with the text | S |
| 27 | Drafts kept on the device, conflict copies when two devices edit | Saves when you leave the box; last save wins | M |
| 28 | Paper themes (legal pad and others), "Copy as markdown" | None | S |
| 29 | Notes tab: drag cards to reorder, project notes as cards (switch), tick to-dos on a card | Grid, search, filter, open | M |
| 30 | List settings: linked project, "display one at a time" | Linked project via API only | S |

## Habits

| # | Feature in v1 | v2 now | Size |
|---|---|---|---|
| 31 | Step-up prompts (when the level was met) with Accept / No, level history so past weeks compare with the target then | None | M |
| 32 | Row of dots per habit; record up to 7 days back | +1 / −1 for today only | S |
| 33 | Three-step new-habit dialog (start low with a suggested third / half, small version, pace) | One form | S |
| 34 | Aspiring habits quick-add; move up and down | Status "aspiring" in the form; no order control | S |

## Insights

| # | Feature in v1 | v2 now | Size |
|---|---|---|---|
| 35 | Insights tab: Week (sessions, time, habits against target, to-dos), Habits (bars per week against target), Projects (time share, last touched, skips) | Plain Log list with a 7-day total | L |
| 36 | Edit a log line (date, where stopped, next action) | Read only (Claude can edit it) | S |

## Whiteboards and stickies

| # | Feature in v1 | v2 now | Size |
|---|---|---|---|
| 37 | Excalidraw whiteboards per project and a Whiteboards tab, thumbnails, favourite tool, "Close without saving" | Table only | L |
| 38 | Floating sticky notes on project pages (drag, resize, pinch, colours, opacity, hide/show) | Table only | M |

## Layout and app-wide

| # | Feature in v1 | v2 now | Size |
|---|---|---|---|
| 39 | Move and resize panels on a desktop (Grafana-style), remove and "Add feature" | Fixed layout | L |
| 40 | Phone Today pills and Today settings (named groups of panels, icons, counts, swipe between pills) | One scrolling page | L |
| 41 | Pop-out windows (free window, side pane, mini) on a desktop | None | L |
| 42 | Redo (Ctrl/Cmd+Shift+Z) | Undo only | S |
| 43 | In-app Back button with history; swipe between tabs on a phone | Browser back only; bottom tabs | M |
| 44 | Theme choice: Light, Dark, Same as computer, **E-ink** (for the Hisense A9) | Follows the computer only; no E-ink | M |
| 45 | Offline: saved copy shows at once, changes queued while offline | Page shell cached; data needs a connection | L |
| 46 | New mode from the app, per-mode accent colour (Work in blue) | Modes via API only; no colour | S |
| 47 | Saving indicator (status dot) | Messages only on failure or undo | S |

## Not needed in v2

- Assistant guide Doc, Start here tab, completing rows typed into the sheet: replaced by the MCP connector.
- Notes as Google Docs, Choose from Drive, Open folder in Drive: Drive sync dropped (DECISIONS D11); Docs are linked as resources.
- Wrapper site on GitHub Pages, Apps Script banner: v2 is its own site and installable.
- Todoist import: done once in v1; comes across with the v1 importer.
- PR notifications: dropped in v1.
