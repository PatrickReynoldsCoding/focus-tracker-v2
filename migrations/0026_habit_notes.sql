-- Habits: a Markdown notes field for notes and useful information (DECISIONS D56). Additive:
-- existing habits get no notes.
ALTER TABLE habits ADD COLUMN notes TEXT;
