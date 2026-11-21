-- Profiles (called modes in the database) each keep their own feature switches, notification
-- settings, last session length and custom link types (DECISIONS D35). These were one value for
-- the whole tracker (settings rows with mode ''): copy each into every profile, so nothing
-- changes for anyone, then remove the old rows. The time zone and the default profile stay global.
INSERT OR IGNORE INTO settings (mode, key, value, updated_at)
  SELECT m.id, s.key, s.value, s.updated_at FROM modes m, settings s
  WHERE s.mode = '' AND s.key IN ('features', 'notify', 'session.length', 'links.types');
DELETE FROM settings WHERE mode = '' AND key IN ('features', 'notify', 'session.length', 'links.types');

-- A deleted profile is put aside here (its modes row as JSON) and can be restored for a week;
-- its data rows keep their mode until it is purged.
CREATE TABLE deleted_modes (
  id TEXT PRIMARY KEY,
  row TEXT NOT NULL,
  was_default INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT NOT NULL
);
