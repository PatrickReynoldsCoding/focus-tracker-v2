-- To-dos become boards (docs/DECISIONS.md D40). A to-do list (lists.kind 'todo') is a board of
-- the board engine like a project's: its groups are columns, it gets a fixed Done column, and its
-- items become cards (tasks rows with list_id). The todos table goes.
--   tasks.from_column_id    the column a card was in before it went into Done (a to-do card goes back there when unticked)
--   tasks.about_project_id  a to-do card's project (was todos.project_id; not that project's board)
-- Data: every to-do keeps its id, title, note, colour, day, done day, place number (ord) and times.
-- An open to-do sits in its group's column; a done one in the list's Done column, remembering its
-- group. A to-do list with no group gets "General". Undo history is cleared: its older steps
-- name the todos table and could not be undone safely any more.

ALTER TABLE tasks ADD COLUMN from_column_id TEXT;
ALTER TABLE tasks ADD COLUMN about_project_id TEXT;

INSERT INTO columns (id, mode, project_id, list_id, name, ord, created, updated_at, is_done)
SELECT substr('tg-' || l.id, 1, 40), l.mode, NULL, l.id, 'General', 1,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0
FROM lists l
WHERE l.kind = 'todo' AND NOT EXISTS (SELECT 1 FROM columns x WHERE x.list_id = l.id AND x.is_done = 0);

INSERT INTO columns (id, mode, project_id, list_id, name, ord, created, updated_at, is_done)
SELECT substr('td-' || l.id, 1, 40), l.mode, NULL, l.id, 'Done',
       COALESCE((SELECT MAX(x.ord) FROM columns x WHERE x.list_id = l.id), 0) + 1,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1
FROM lists l
WHERE l.kind = 'todo' AND NOT EXISTS (SELECT 1 FROM columns x WHERE x.list_id = l.id AND x.is_done = 1);

INSERT INTO tasks (id, mode, project_id, list_id, column_id, title, note, color, ord, created, updated_at, day, done, from_column_id, about_project_id)
SELECT g.id, g.mode, NULL, g.list_id,
       CASE WHEN g.done IS NULL THEN g.gid ELSE (SELECT c.id FROM columns c WHERE c.list_id = g.list_id AND c.is_done = 1 LIMIT 1) END,
       g.title, g.note, g.color, g.ord, g.created, g.updated_at, g.day, g.done,
       CASE WHEN g.done IS NULL THEN NULL ELSE g.gid END,
       g.project_id
FROM (
  SELECT t.*, COALESCE(
           (SELECT c.id FROM columns c WHERE c.id = t.group_id AND c.list_id = t.list_id AND c.is_done = 0),
           (SELECT c.id FROM columns c WHERE c.list_id = t.list_id AND c.is_done = 0 ORDER BY c.ord, c.created LIMIT 1)) AS gid
  FROM todos t JOIN lists l ON l.id = t.list_id AND l.kind = 'todo'
) g;

DROP TABLE todos;

DELETE FROM undo;

CREATE INDEX tasks_from_column ON tasks(from_column_id);
CREATE INDEX columns_list_done ON columns(list_id, is_done);
