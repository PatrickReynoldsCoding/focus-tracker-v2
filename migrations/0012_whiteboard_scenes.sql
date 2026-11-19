-- Whiteboard drawings move to their own table (V1-GAPS 37). Lists of boards then never read a
-- drawing, and renaming or moving a board does not copy its drawing into the undo history
-- (an undo row holds the row before and after, and D1 allows about 2 MB per row).
-- The copy and the clearing run in one batch, so a drawing is never lost on the way.
CREATE TABLE whiteboard_scenes (
  id TEXT PRIMARY KEY,                   -- the whiteboard's id
  mode TEXT NOT NULL,
  scene TEXT NOT NULL,                   -- Excalidraw scene JSON
  created TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO whiteboard_scenes (id, mode, scene, created, updated_at)
  SELECT id, mode, scene, created, updated_at FROM whiteboards WHERE scene IS NOT NULL AND scene != '' AND scene != 'null';
UPDATE whiteboards SET scene = NULL WHERE scene IS NOT NULL;
