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
2. Habits is left out of the usual Today pill but stays in the All pill, so habits show twice there. Default: kept in All; its ⋯ menu (a long press on a phone) → Remove takes it out.
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

## Move and resize on the page, no Edit layout (v0.21.0)

1. A phone's height for a panel is its own (`ph`), apart from the computer's (`h`): the widths differ, so one height rarely suits both. The order is shared (moving a panel on the phone moves it in the desktop grid's order too, as the pill sheet's ▲ ▼ already did). Default: separate heights, shared order.
2. Where a long press starts arranging: anywhere on a panel (its title always) except fields, a note's text and editor (so text can still be selected), a whiteboard being drawn, a project's board, and list items that drag (resources, criteria). Default: as described.
3. A long press works on any screen under 900 px (also a narrow window with a mouse); from 900 px the grid's hover handles are used. Default: under 900 px.
4. Page actions (Add panels…, Reset this pill's/page's layout) sit at the bottom of every panel's ⋯ menu on a computer, and in the Arrange bar on a phone, not in a separate page menu. Default: as described.
5. "Add panels…" is a stop-gap until the "Add panel" button: in a pill it opens the pill's sheet, on the All pill and the project page the old Add feature list (renamed Add panels). Default: kept until that item.
6. In the desktop grid, Pop out moved from the ⧉ on the panel's edge into the ⋯ menu (fewer handles); between 760 and 899 px, where there is no grid, the ⧉ stays. Default: as described.
7. A phone height can be 120–4000 px (room for the Arrange handles); a computer height stays 60–4000. Default: as described.
8. There is no way to start arranging on a phone without a long press (no button). Default: long press only, as asked.


## Add panel and Add file (v0.22.0)

1. "+ Add panel" is under the panels on every screen, and also in the pill bar on a computer (not on a phone, where the bar has no room). Default: as described.
2. Removing a note, list or whiteboard from a pill takes it off Today and out of every pill, not only out of that pill. Default: off Today and out of every pill, as asked.
3. On a project page, Add file moves the file into the project's folder (so it becomes the project's and shows in its Lists, Whiteboards or Resources panel); project pages share one layout, so a file cannot be a panel of one project's page. Default: move into the project's folder.
4. The pill sheet (✎ Edit pill, New pill) still lists the notes and lists already on Today, but not every other one. Default: as described.
5. Today's picker leaves out links (they have no panel); a project's picker offers links too. Default: as described.
6. Add file's lists are sorted by last changed (recent first), with a Recent section of six at the top level. Default: as described.
7. The panel just added goes at the end of the pill or page and is scrolled into view. Default: at the end.

## Columns are statuses, fixed Done (v0.23.0)

1. Issue links (D16's open question): a card in its board's Done column counts as finished, whatever the column is called. Default: yes.
2. The Done column can be renamed (it stays the Done status). Default: renamable; it cannot be moved or deleted.
3. Hide done is remembered per project on the server, the same on every device. Default: shown (not hidden) for every project, old and new.
4. A card is done whenever it is in Done, also without a day (D30 only counted cards with a day). Cards already in Done got a done day when the update ran (the day each was last changed). Default: as described.
5. Unticking a card in the Today list, or Claude's `done: false`, moves it to the board's first column (not back to where it was before). Default: the first column, as in D30.
6. Migration: the last column named done, complete(d) or finished became the Done column and moved to the end; Work boards with Waiting, In-review or Blocked after Done now show them before Done. Default: as described.
7. Folded Done is a slim strip with ✓, the name and the count; tapping it opens Done again (and turns Hide done off). Default: as described.

## Profiles (v0.30.0)

1. Notification settings are now per profile (D17 had them global): quiet hours and "which devices show notifications" must be set in each profile. Default: per profile, as asked; every profile started with the old values.
2. The last session length is per profile (v1 had one for everything). Default: per profile, as asked.
3. Copy settings copies Today's pills and layouts but leaves out the notes, lists and whiteboards placed in them, and does not copy the usual weekly rotation (it names the other profile's categories). Default: as described.
4. New profile starts with "Default settings" chosen; "Copy settings from" offers the open profile first. Default: default settings.
5. A deleted profile can be restored for 7 days, then it is purged; Delete now purges at once. Default: 7 days.
6. Opening a profile in the app still makes it the default (menu bar, widgets, Claude follow it, as in v0.25.0). Manage profiles can turn that off so Make default sticks. Default: on.
7. Claude's tool list shows a tool while its feature is on in any profile; calling it in a profile where it is off fails with a message. Default: as described (the connector cannot know the profile before a call).
8. Profile names must be different (ignoring case), because deleting asks for the name. Default: unique.
9. The profile dropdown stays the plain dropdown of v0.25.0 (no colour dots in it; browsers cannot show them in a dropdown). Default: plain dropdown, with ＋ New profile… and ⚙ Manage profiles… at the end.

## No "show on Today" switches (v0.31.0)

1. The old Notes tab (Files off) lost its Project notes tickbox and the project-note cards with it, so nothing is stuck on. Default: gone; project notes are on Files and project pages.
2. The "Today" tag on old Notes tab cards and "· on Today" under a whiteboard stay (they inform, they do not switch). Default: kept.
