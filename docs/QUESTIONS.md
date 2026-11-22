# Open questions

Questions the owner could not be asked while an item was built.
Each open one has 2-4 numbered options and a suggestion.
Reply with the question tag and a number, for example "0.34.0 Q2: 2".
The tag in brackets, such as [0.35.0 Q3], is the original question number.

New questions from later work go at the end, under "Still open", in the same style.

## Answered

Applied, or being applied in the next batch.

- [Pills Q1] A new note or list put on Today goes into the pill on screen and into All. Done in 0.43.0 (D55: Add file already did this).
- [Pills Q3] Focus card size, shared or per device: owner does not mind. Ignored, stays shared.
- [Files Q3] The folder decides the project. Kept.
- Files layout (new feature): Files root shows one "Projects" folder. Inside it is a folder per category, and inside each a folder per project. Projects with no category go in "No category". Done in 0.43.0 (D52).
- [Profiles Q6] Opening a profile does not make it the default. The default stays the one chosen in Manage profiles. Done in 0.43.0 (D54).
- Claude can be told "add X to Y in my work profile". Every tool's profile argument will accept a profile name (any case) as well as the id, and the connector instructions will say so. Done in 0.43.0 (D54).
- [0.35.0 Q2] A to-do's Done starts folded, remembered per device. Kept.
- Board view: the folded Done strip sits at the far right of the board. Done in 0.43.0 (D55).
- [0.35.0 Q1] Board or List view stays per device. Kept.
- [0.35.0 Q9] Category buttons only, no drop-down beside them. Kept.
- [0.35.0 Q10] Tags: every file linked to a project, and the project and its notes, gets an automatic tag with the project name. It follows renames and shows in the Files tag filter, widgets and Claude's list_files. Project notes can have extra tags, and any file can have several. Done in 0.43.0 (D53).
- [Widgets Q17] The Files widget lets you tick to-do items directly. Tapping the title opens the file. Queued.
- [Widgets Q14] Files widget stays at 30 files and 200 characters by default. Kept.
- [Widgets Q20 and Q24] Opening a file from a widget switches the app to that widget's profile. But no widget follows the open profile any more: every widget (Today, Files, Single file) picks a profile in its setup screen, can change it in its settings, and keeps it. Quick add and notifications still follow the app's open profile. Queued.
- [0.35.0 Q5, Q6] Plain list List view, and dragging in panels: answered in 0.42.0 (D49). Done.

## Defaults we will keep unless told otherwise

No real choice here, or the default is clearly right.

- [Pills Q2, Q4, Q5] Usual pills are Today, Notes and More. Swiping between pills is on phones only. The pill sheet's up and down order also orders the desktop grid.
- [Today list Q1, Q7] Cards with a day show in the list. Ticking a project card moves it to Done. A ticked line leaves the list at once.
- [Today list Q6] Today reloads when the app returns after a minute, and every 5 minutes.
- [Files Q1, Q2, Q4, Q5] Only links show as files. Finished projects' folders are hidden behind "Show n finished projects". Renaming a project's folder renames the project. A project's notes cannot leave its folder.
- [Files Q7, Q8, Q9, Q10] Deleting a file has no prompt (Undo is offered). Grid on a computer, list on a phone. `#/notes` opens the top of Files. File colours are not shown.
- [0.21.0 Q1-Q7] Phone and computer panel heights are separate and the order is shared. Long press arranges under 900 px. Page actions sit in each panel's menu. Pop out lives in the menu.
- [0.22.0 Q1-Q7] Add panel and Add file work as built. The new panel goes at the end. Add file lists show recent first.
- [0.23.0 Q1, Q2, Q4, Q6, Q7] A card in Done counts as finished. Done can be renamed but not moved or deleted. The migration moved the last "done" column to the end. Folded Done is a slim strip.
- [Profiles Q1-Q5, Q7-Q9] Notifications and session length are per profile. Copy settings leaves out notes and the weekly rotation. A new profile starts with default settings. Deleted profiles come back for 7 days. Names must be unique. The profile dropdown is plain.
- [0.31.0 Q1, Q2] Old Notes tab has no Project notes switch. "Today" tags stay.
- [0.32.0 Q1-Q4] Label colour comes from the project id. No label in Add file as a link, inside the project's own folder, or on done rows.
- [0.33.0 Q1-Q3] "Computer" means 760 px and up. Pill editor hidden when the flag is off. The All switch is ignored there.
- [0.34.0 Q5] Undo history was cleared once by the migration.
- [0.35.0 Q4, Q7, Q11] The Stack columns toggle is gone. A to-do's day is set in its dialog. Whiteboards are tagged from Files.
- [0.38.0 Q18, Q19, Q21, Q23] Plain-list items open the list from the Single file widget. Whiteboards and links show a title only. Narrow layout below 200 dp. With Insights off, the Log tab returns.
- [0.42.0 Q28, Q31-Q33] A plain list opens in List view. The phone list panel drags among its four items. Tapping an item's name opens its dialog. One flag, `panel-restyle`, covers the slim panels.

## Still open

### Today and pills

**[0.19.0 Q2] Habits show twice in the All pill. What should we do?**
1. Keep both (Habits panel and the list rows).
2. Hide the Habits panel from All when the Today list shows habits.
3. Remove the Habits panel from All, always.

My suggestion: 2 (no repeats, and the panel stays for anyone who turns the list off).

**[0.19.0 Q3] Should reminders and sessions appear in the Today list?**
1. No. Due reminders stay as banners (as now).
2. Reminders only, as lines in the list.
3. Both.

My suggestion: 1 (the banners already work, and v1 did the same).

**[0.19.0 Q4] "Not today" is only on weekly habits. Offer it on daily ones too?**
1. Weekly only (as now).
2. Daily habits too.

My suggestion: 1 (a daily habit has no spare day to skip; Claude can still do it).

**[0.19.0 Q5] Android Today widget shows to-dos and habits left, not the Today list. Move it to the list?**
1. Leave it.
2. Move it in the next Android version.

My suggestion: 2 (so it matches the app; it needs a new app version anyway).

**[0.21.0 Q8] Start arranging on a phone without a long press?**
1. Long press only (as now).
2. Also an "Arrange" item in each panel's menu.

My suggestion: 2 (long press is hard to find; one menu item costs nothing).

### Files and tags

**[0.20.0 Q6] Search ignores to-do and list item titles. Include them?**
1. Names, notes, links and folders only (as now).
2. Also item titles.

My suggestion: 2 (people search for the thing they wrote).

**[0.35.0 Q12] Files' tag filter clears when you open another folder. Keep it?**
1. Clear it (as now).
2. Keep it while you move between folders.
3. Keep it, with a small "clear" chip.

My suggestion: 3 (useful when browsing, and easy to undo).

**[0.35.0 Q13] Cards and rows show two tags, then "+n". Show more?**
1. Two.
2. Three.
3. As many as fit.

My suggestion: 1 (keeps rows tidy; automatic project tags now add one).

### Boards, to-dos and lists

**[0.34.0 Q1] A project's board is not a file in Files. Should a project show as a to-do file too?**
1. No. Project folders already hold it (as now).
2. Yes, as a file inside its folder.

My suggestion: 1 (the project already has its own page).

**[0.34.0 Q2 and 0.23.0 Q5] Unticking a project card puts it in the first column. Put it back where it came from?**
1. First column (as now).
2. The column it was in before.

My suggestion: 2 (it is what people expect; the card already remembers it).

**[0.34.0 Q3] Order of the Done column in Board view?**
1. Ticked cards go to the end (as now).
2. Newest ticked first.
3. Keep the order they had.

My suggestion: 2 (you see what you just finished at the top).

**[0.34.0 Q4] Giving a plain list item a day: what happens?**
1. The server refuses (planned).
2. Refuse, and offer "Convert to a to-do?".

My suggestion: 2 (it answers why, and gives a way forward).

**[0.34.0 Q6] Deleting a to-do group deletes its open to-dos. Change that?**
1. Delete them (as now).
2. Ask: move them to another group, or delete.
3. Always move them to the first group.

My suggestion: 2 (nothing is lost by accident).

**[0.34.0 Q7] Drop the old "to-do about a project" link (production has none)?**
1. Keep it.
2. Drop it now.

My suggestion: 2 (it is unused and confusing).

**[0.35.0 Q3] Should a project open in List view on a phone?**
1. Board on every device (as now).
2. List on a phone.

My suggestion: 2 (columns are cramped on a phone).

**[0.35.0 Q8] A category with no projects in the current status view is hidden. Change?**
1. Hide it, counts follow the chips (as now).
2. Always show every category.
3. Show every category, counts ignore the status chips.

My suggestion: 1 (less clutter).

### Habits and the Today list

**[0.42.0 Q29] The slim Habits panel has no day strip. Add a "Days" toggle?**
1. No. Use the Habits tab (as now).
2. Yes, a toggle per panel.

My suggestion: 1 (keeps the panel slim).

**[0.42.0 Q30] Should met habits fold away like the Today list's done lines?**
1. Stay in place, ticked and struck through (as now).
2. Fold into "n done".

My suggestion: 2 (same behaviour as the list).

**[0.42.0 Q34] A skipped (Not today) daily habit is taken out of the weekly target. Count it as missed instead?**
1. Take it out, no penalty (as now).
2. Count as missed.

My suggestion: 1 (skipping is meant to be allowed).

**[0.44.0 Q1] Habits already had a hidden "description" field (Claude and aspiring ideas used it). Merge it into the new notes?**
1. Keep both; the dialog shows notes only (as now).
2. Move descriptions into notes and drop the field.

My suggestion: 1 (nothing to migrate; ask again if it confuses).

**[0.44.0 Q2] In Plan my week the habit chips pick which habit to plan, so they do not open the dialog; the names on each day and the line under the chips do. Fine?**
1. Yes (as now).
2. A long press on a chip opens it too.

My suggestion: 1.

**[0.44.0 Q3] Should Search (and Claude's search) look in habit notes?**
1. No, as now.
2. Yes.

My suggestion: 2, next time search is touched.

### Profiles and settings

**[0.38.0 Q26] "All profiles" in Settings goes back to one profile on reload. Remember it?**
1. Per visit (as now).
2. Remember the choice.

My suggestion: 1 (a later change cannot reach every profile by surprise).

**[0.38.0 Q27] Values equal in every profile stayed as each profile's own. Make them shared?**
1. Keep as own (as now).
2. Make them "all profiles" values.

My suggestion: 1 (nothing changes; use All profiles when you want it).

### Widgets and Android

**[0.38.0 Q15] A folder's widget includes folders inside it. Keep?**
1. Included (as now, can be unticked).
2. Not included.

My suggestion: 1 (with the new Projects folder layout, a category widget needs it).

**[0.38.0 Q16] Files widget shows a to-do's open items only. Keep?**
1. Open only (as now).
2. Open items, then a "n done" line.

My suggestion: 1 (small widget, little room).

**[0.38.0 Q22] With Habits off, step-up prompts and away days stay listed. Hide them?**
1. Leave listed (as now).
2. Hide them while Habits is off.

My suggestion: 2 (switches that do nothing are confusing).

**[0.38.0 Q25] The widget's ✕ (Not today) is on to-dos, cards and weekly habits. Keep?**
1. As now.
2. Remove it from the widget (fewer accidental taps).

My suggestion: 1 (it matches the web).

**[Android 0.5.0 Q1] Opening the app from the Today widget (the focus project, Stop…, Choose) switches the app to the widget's profile, like opening a file. Keep?**
1. As now (the project is in that profile).
2. Only files switch; the Today widget opens the app in its open profile.

My suggestion: 1.

**[Android 0.5.0 Q2] A tick on the Files widget only ticks (the widget lists open items); untick in the app. Keep?**
1. As now.
2. Keep a ticked item for a while with ☑, tap again to untick.

My suggestion: 1 (Undo in the app covers a mis-tap).

### Files tree and automatic tags (0.43.0)

**[0.43.0 Q1] "No category" shows inside Projects even when no project is in it. Hide it when empty?**
1. Always show it (as now: it is where a project's folder goes to lose its category).
2. Only when a project has no category.

My suggestion: 1 (Move… needs it as a place to go).

**[0.43.0 Q2] A project's folder can no longer go into a folder of your own (it always sits in its category's folder). Allow it again?**
1. No (as now): Projects › category › project only.
2. Yes, and then it shows only in your folder, not under Projects.

My suggestion: 1 (one place for every project).

**[0.43.0 Q3] The automatic project tag is not shown on file cards, rows and page headers while project labels are on (the label already names the project). Show it there too?**
1. Hide it there (as now); it shows in the Tags row, the tag editor, widgets and Claude.
2. Show it everywhere, next to the label.

My suggestion: 1 (the same name twice on one card is noise).

**[0.43.0 Q4] The "No tag" filter ignores the automatic project tag (a project's file with no tag of its own counts as untagged). Change it?**
1. Ignore it (as now).
2. Count it: only files with no project and no tag.

My suggestion: 1 (No tag is for finding files you have not tagged).

**[0.43.0 Q5] Searching Files for a project's name now finds every file of that project (through its tag). Keep it?**
1. Keep it (as now).
2. Only names, text and folders, as before.

My suggestion: 1.

### Other

**Subtasks (0.45.0, D57)**
1. Should the Android Today and Files widgets show subtasks? Options: (a) no, the to-do only (now); (b) a `1/3` count after the title; (c) the open subtasks under it with ticks. My suggestion: (b) later, if you miss it; the widgets are small.
2. Should a subtask be able to carry a day, note or colour? Options: (a) no, title and tick only (now); (b) a note. My suggestion: (a), a subtask is one line; make it a to-do if it needs more.
3. Should a to-do with every subtask ticked ask "Tick the to-do too?" Options: (a) never (now, as you chose); (b) a small hint on the chip. My suggestion: (a).

**Plain list look (0.46.0, D58)**
1. Should a to-do get the same look (group boxes, chips, ⋯ menu)? Options: (a) no, lists only (now); (b) yes, keeping its tick circles and Done. My suggestion: (b) later, if the chips and two-line text help there too.
2. Group colours follow the group's place (first green, second amber...). Should a group choose its own colour? Options: (a) by place (now); (b) a colour picker in the group's header. My suggestion: (a) until you want to match colours to meaning.
3. Chips show the site's host (`docs.google.com`). Should they show the Markdown link's name instead when there is one? Options: (a) host chip, name as text (now, as in the mockup); (b) name in the chip. My suggestion: (a).
4. Groups fold per device. Should they fold for all devices? Options: (a) per device (now); (b) saved on the list. My suggestion: (a).

**Keep in mind look (0.47.0, D59)**
1. The frosted glass always uses the accent colour, not the list's own colour (only the ✦ and the current dot use it). Options: (a) accent glass (now); (b) tint the glass with the list's colour. My suggestion: (a) to stay subtle.
2. Dots are not tappable (too small to hit). Options: (a) not tappable (now); (b) tappable with a bigger invisible hit area. My suggestion: (a); swipe and tap cover it.
3. The largest text is 72 px (short quotes in a big panel). Options: (a) 72 px (now); (b) a lower cap such as 48 px. My suggestion: (a), say if a one-word quote looks too big.
4. Lora covers Latin letters only; other scripts fall back to Georgia. Options: (a) Latin only, 23 KB (now); (b) add Latin-extended, 13 KB more. My suggestion: (a).
5. E-ink uses plain Georgia italic, not Lora, as you asked. Options: (a) Georgia (now); (b) Lora on E-ink too. My suggestion: (a).

## Mobile Settings (D60)
1. Order of the sections in the list is the registry order (General, Appearance, Sessions, Notifications …, Profiles later). Options: (a) registry order (now); (b) group with headings (General / Features / Connect, as in mockup A). My suggestion: (a) for now; (b) if the list grows past about 15.
2. Desktop keeps the sidebar. Options: (a) keep (now); (b) use the same drill-down on desktop too. My suggestion: (a).
3. Sections without a computed summary show a fixed line (for example "Work and break lengths"). Options: (a) fixed lines (now); (b) compute every one. My suggestion: (a); say which ones you want live.
4. The phone's in-app "← Back" button and the ‹ both show inside a section. Options: (a) both (now); (b) hide the app Back inside Settings sections. My suggestion: (a).
