-- Subtasks (DECISIONS D57): a card or to-do can have a short checklist of subtasks, one level.
-- A table of their own, so no query about cards, the Today list or widgets ever sees them.
-- Additive: nothing existing changes.
CREATE TABLE subtasks (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  task_id TEXT NOT NULL,
  title TEXT NOT NULL,
  done TEXT,
  ord REAL NOT NULL DEFAULT 0,
  created TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX subtasks_task ON subtasks(task_id, ord);
CREATE INDEX subtasks_mode ON subtasks(mode);
