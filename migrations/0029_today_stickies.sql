-- Sticky notes on Today (DECISIONS D62): a note may belong to no project (it is then the profile's
-- Today note). SQLite cannot drop NOT NULL, so the table is rebuilt with the same rows.
CREATE TABLE stickies_new (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  project_id TEXT,
  text TEXT,
  color TEXT,
  opacity REAL,
  x REAL, y REAL, w REAL, h REAL,
  created TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO stickies_new (id, mode, project_id, text, color, opacity, x, y, w, h, created, updated_at)
  SELECT id, mode, project_id, text, color, opacity, x, y, w, h, created, updated_at FROM stickies;
DROP TABLE stickies;
ALTER TABLE stickies_new RENAME TO stickies;
