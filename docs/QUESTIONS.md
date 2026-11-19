# Open questions

Questions the owner could not be asked while an item was built. Each gives the default that was chosen; say if you want it changed.

## Pills are tabs on every screen (v0.18.0)

1. Panels not in any pill: an "All" pill at the end shows every panel on Today. New notes and lists put on Today go to All only, not into the pill on screen. Default: All shown (can be hidden in Today settings).
2. The usual pills are Today (to-dos, habits, this week), Notes (notes, lists, to-do lists, whiteboards on Today) and More (the rest). Default: these names and icons; once you change a pill they are saved as they are, so later notes and lists only show in All.
3. The focus card's Compact / Full / Hidden is one setting for the phone and the computer. Default: Compact everywhere.
4. Swiping between pills works on a phone only, not on a touch screen wider than 760 px. Default: phone only.
5. The ▲ ▼ order in a pill's sheet also reorders its desktop grid. Default: yes, so the phone and the computer show the same order.

## The Today list (v0.19.0)

1. Cards can be for a day too, so project work shows in the list. Ticking a project card in the list moves it to its board's last column (Done); a plain list's item stays where it is. Default: on (flag `today-panel`).
2. Habits is left out of the usual Today pill but stays in the All pill, so habits show twice there. Default: kept in All; Edit layout → Remove takes it out.
3. Reminders and sessions are not in the list (v1 did not have them either; due reminders show as banners above Today). Default: not included.
4. "Not today" is offered on weekly habits only, as in v1. Default: weekly only (Claude can still skip a daily habit).
5. The Android widget still shows to-dos for today and habits left, not cards. Moving it to the Today list (`today_list` in `/api/status`) needs a new app version. Default: not changed in this release.
6. Today reloads when the app comes back to the front after a minute or more, and every 5 minutes while Today is on screen. Default: on, no setting.
7. A ticked line leaves the list at once and folds into "✓ n done" (no short pause first). Default: at once, as in v1.
