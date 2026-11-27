-- The focus queue (DECISIONS D67): the owner's ordered queue of cards and to-dos (rows of tasks)
-- to work on, per profile, no size limit. The first is "Now". A task is in a profile's queue at
-- most once. Additive: nothing existing changes.
CREATE TABLE focus_queue (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  task_id TEXT NOT NULL,
  ord REAL NOT NULL DEFAULT 0,
  created TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (mode, task_id)
);
CREATE INDEX focus_queue_mode ON focus_queue(mode, ord);
CREATE INDEX focus_queue_task ON focus_queue(task_id);
