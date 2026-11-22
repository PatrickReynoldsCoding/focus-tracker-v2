-- Tags (docs/DECISIONS.md D43): free labels on any file (a note, list, to-do, whiteboard, link, a
-- project and its notes), per profile. Additive only: two new tables, nothing existing changes.
--   tags       a profile's tags; the name is unique in the profile whatever its case (checked by
--              src/modules/tags.ts, not by an index, so Undo can always put a row back)
--   tag_links  one row per tag on a file: kind is the kind of row the file is (lists,
--              whiteboards, resources, projects), target_id its id
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  created TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX tags_mode_name ON tags(mode, name COLLATE NOCASE);

CREATE TABLE tag_links (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX tag_links_tag ON tag_links(tag_id);
CREATE INDEX tag_links_target ON tag_links(mode, kind, target_id);
