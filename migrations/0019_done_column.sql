-- Columns are statuses; every project board has one fixed Done column, always last
-- (docs/DECISIONS.md D34). A card is done exactly when it is in that column.
--   columns.is_done    1 for a project's Done column (one per project)
--   projects.hide_done 1 to fold the Done column into a slim strip on the board
-- Data: the last column named done, complete(d) or finished becomes the Done column and
-- moves to the end of its board; a project without one gets a new "Done" column. Cards in
-- Done get a done day (the day they were last changed); a project card marked done but not
-- in Done moves into it.

ALTER TABLE columns ADD COLUMN is_done INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN hide_done INTEGER NOT NULL DEFAULT 0;

UPDATE columns SET is_done = 1
WHERE project_id IS NOT NULL
  AND lower(trim(name)) IN ('done', 'complete', 'completed', 'finished')
  AND NOT EXISTS (
    SELECT 1 FROM columns x
    WHERE x.project_id = columns.project_id AND x.id != columns.id
      AND lower(trim(x.name)) IN ('done', 'complete', 'completed', 'finished')
      AND (x.ord > columns.ord OR (x.ord = columns.ord AND (x.created > columns.created OR (x.created = columns.created AND x.id > columns.id))))
  );

UPDATE columns
SET ord = (SELECT MAX(x.ord) FROM columns x WHERE x.project_id = columns.project_id) + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE is_done = 1
  AND EXISTS (SELECT 1 FROM columns x WHERE x.project_id = columns.project_id AND x.id != columns.id AND x.ord >= columns.ord);

INSERT INTO columns (id, mode, project_id, list_id, name, ord, created, updated_at, is_done)
SELECT lower(hex(randomblob(5))), p.mode, p.id, NULL, 'Done',
       COALESCE((SELECT MAX(x.ord) FROM columns x WHERE x.project_id = p.id), 0) + 1,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1
FROM projects p
WHERE NOT EXISTS (SELECT 1 FROM columns x WHERE x.project_id = p.id AND x.is_done = 1);

UPDATE tasks SET done = substr(updated_at, 1, 10)
WHERE done IS NULL AND project_id IS NOT NULL
  AND column_id IN (SELECT id FROM columns WHERE is_done = 1);

UPDATE tasks
SET column_id = (SELECT c.id FROM columns c WHERE c.project_id = tasks.project_id AND c.is_done = 1)
WHERE done IS NOT NULL AND project_id IS NOT NULL
  AND column_id NOT IN (SELECT id FROM columns WHERE is_done = 1);

CREATE INDEX columns_done ON columns(project_id, is_done);
