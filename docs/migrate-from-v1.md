# Move your data from Focus Tracker v1

The importer reads one v1 spreadsheet (one mode) at a time and adds its rows to v2 with the same ids, so it can be run again safely: rows already there are skipped.

1. Make sure v1 has run its latest migration (open the app once in each mode).
2. In Google Sheets, open the mode's spreadsheet ("Focus Tracker - Personal") and choose File → Download → Microsoft Excel (.xlsx).
3. Notes: v1 keeps each project's notes and each note in a Google Doc. Download the ones you want (File → Download → Microsoft Word, or Markdown) into one folder. Files named after the Doc id (`<doc id>.md`) are matched by id; files named `<project or note list name> notes.docx` (Drive for desktop uses this) are matched by name, ignoring case and punctuation. Files with "conflict" in the name are skipped, and the importer lists any file it could not match. Without a file a note gets the first ~300 characters v1 kept as a preview, and the importer lists which Docs were missing. Claude can also do this step through the Drive connector and the tracker's `write_note` tool.
4. Make an API token in v2 (Settings → Devices and API tokens), then:

   ```sh
   npm run import:v1 -- --url https://your-tracker --token ft_... --mode personal --xlsx "Focus Tracker - Personal.xlsx" --docs notes/ --whiteboards boards/
   ```

   Add `--dry-run` first to see what it would import. Repeat with `--mode work` for the Work spreadsheet.

What comes across: categories, projects, backlog, Kanban columns and cards (rich-text notes become Markdown), lists, to-do lists and to-dos, notes, done criteria, resources, habits and the habit log, the session log, skips, reminders, stickies, project links, whiteboard names, and the weekly rotation. Whiteboard drawings come across if you pass the folder of `<slug>-<id>.excalidraw.json` files (`--whiteboards`); the id must match a Whiteboards row. Short v1 category ids such as `job` become `cat_job`. Not imported: layouts and pills (v2 lays pages out differently), the undo history, and Script Properties such as the running session.
