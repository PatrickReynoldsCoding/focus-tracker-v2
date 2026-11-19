-- Lists on Today: how to show them (full list, or one item at a time) and when they were added.
ALTER TABLE lists ADD COLUMN display TEXT NOT NULL DEFAULT 'full';   -- full | one
ALTER TABLE lists ADD COLUMN seconds INTEGER NOT NULL DEFAULT 30;    -- one at a time: seconds per item (5 to 3600)
ALTER TABLE lists ADD COLUMN today_at TEXT;                          -- when it was put on Today (panels keep that order)
ALTER TABLE notes ADD COLUMN today_at TEXT;
UPDATE lists SET today_at = created WHERE show_today = 1;
UPDATE notes SET today_at = updated_at WHERE show_today = 1;
