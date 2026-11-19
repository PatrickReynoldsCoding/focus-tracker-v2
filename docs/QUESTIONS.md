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

## Files (v0.20.0)

1. Links (web addresses and Google Drive items) show as files with their icons; phone numbers, emails and text do not, and resources a category shares stay on the Projects tab. Default: links only, shared ones left out.
2. Project folders sit at the top level of Files, next to your own folders; finished (done or dropped) projects' folders are hidden behind "Show n finished projects". Default: top level, finished ones hidden (per device). You can move project folders into a folder of your own.
3. The folder decides the project: moving a file into a project's folder makes it that project's (it shows on the project page too), moving it out takes it off the project. Default: on, no setting.
4. Renaming a project's folder renames the project. Default: yes (the folder always carries the project's name).
5. A project's notes cannot be moved out of its folder, and an empty project note shows only inside that folder. Default: as described.
6. Search and type filters look in the folder on screen and everything inside it (at the top: everywhere); search covers names, note text, link addresses and folder names, not to-do or list item titles. Default: as described.
7. Deleting a file has no "Are you sure?" (Undo is offered, like whiteboards); deleting a folder that holds something asks: move what is inside up (first choice) or delete everything. Default: as described.
8. Grid view is the default on a computer, list view on a phone; sort is by name. Default: as described, remembered per device.
9. `#/notes` opens the top of Files (all files), not a Notes filter, because the Notes tab held notes, to-do lists and lists. Default: the top of Files.
10. The Notes tab's "Project notes" cards switch and colours are not used by Files (a file's colour does not show). Default: not shown.
