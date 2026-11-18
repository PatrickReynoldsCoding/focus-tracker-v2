-- Focus Tracker v2: first schema.
-- Every user-data row has id, created, updated_at. Rows that belong to a mode
-- (Personal, Work, ...) carry a `mode` column: one database, many modes
-- (docs/DECISIONS.md D3). `ord` is a REAL so a move only rewrites one row.
-- Dates are ISO text: days as 2026-11-18, times as 2026-11-18T14:05:00.000Z.
-- Rich text (notes, task notes) is Markdown (docs/DECISIONS.md D5).

CREATE TABLE modes (
  id TEXT PRIMARY KEY,                 -- 'personal', 'work', ...
  label TEXT NOT NULL,
  account_id TEXT,                     -- connected Google account for Drive sync
  drive_folder_id TEXT,
  ord REAL NOT NULL DEFAULT 0,
  created TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  refresh_token_enc TEXT,              -- AES-GCM, key from the TOKEN_KEY secret
  scopes TEXT,
  status TEXT NOT NULL DEFAULT 'ok',   -- ok | needs_login | blocked
  last_sync TEXT,
  change_token TEXT,
  created TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  label TEXT NOT NULL,
  color TEXT,
  ord REAL NOT NULL DEFAULT 0,
  account_id TEXT,
  drive_folder_id TEXT,
  created TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX categories_mode ON categories(mode, ord);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  name TEXT NOT NULL,
  category_id TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- active | paused | done | dropped
  next_action TEXT,
  locked_until TEXT,
  last_touched TEXT,
  show_next_action TEXT,                -- 'on' | 'off' | NULL (follow the mode default)
  ord REAL NOT NULL DEFAULT 0,
  created TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX projects_mode ON projects(mode, status);

CREATE TABLE backlog (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  title TEXT NOT NULL,
  category_id TEXT,
  note TEXT,
  ord REAL NOT NULL DEFAULT 0,
  created TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX backlog_mode ON backlog(mode, ord);

CREATE TABLE lists (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'list',    -- list | todo | note
  project_id TEXT,
  show_today INTEGER NOT NULL DEFAULT 0,
  color TEXT,
  ord REAL NOT NULL DEFAULT 0,
  created TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX lists_mode ON lists(mode, ord);

-- Kanban columns of a project, columns of a plain list, groups of a to-do list.
CREATE TABLE columns (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  project_id TEXT,
  list_id TEXT,
  name TEXT NOT NULL,
  ord REAL NOT NULL DEFAULT 0,
  created TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX columns_project ON columns(project_id, ord);
CREATE INDEX columns_list ON columns(list_id, ord);

-- Kanban cards and plain-list items. Exactly one of project_id / list_id.
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  project_id TEXT,
  list_id TEXT,
  column_id TEXT NOT NULL,
  title TEXT NOT NULL,
  note TEXT,
  color TEXT,
  ord REAL NOT NULL DEFAULT 0,
  created TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX tasks_column ON tasks(column_id, ord);
CREATE INDEX tasks_project ON tasks(project_id);
CREATE INDEX tasks_list ON tasks(list_id);

CREATE TABLE todos (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  list_id TEXT NOT NULL,
  group_id TEXT,
  title TEXT NOT NULL,
  day TEXT,                              -- NULL = anytime
  done TEXT,                             -- the day it was done, NULL = open
  project_id TEXT,
  note TEXT,
  color TEXT,
  ord REAL NOT NULL DEFAULT 0,
  created TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX todos_list ON todos(list_id, ord);
CREATE INDEX todos_day ON todos(mode, day, done);

CREATE TABLE criteria (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  project_id TEXT NOT NULL,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  ord REAL NOT NULL DEFAULT 0,
  created TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX criteria_project ON criteria(project_id, ord);

CREATE TABLE resources (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  project_id TEXT,                       -- NULL = shared by the category
  category_id TEXT,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'link',     -- link | drive | phone | email | text
  value TEXT NOT NULL,
  grp TEXT,
  note TEXT,
  ord REAL NOT NULL DEFAULT 0,
  created TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX resources_project ON resources(project_id);

CREATE TABLE habits (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  name TEXT NOT NULL,
  intention TEXT,
  sessions INTEGER,
  per TEXT,                              -- day | week
  size TEXT,
  small_version TEXT,
  goal TEXT,
  step_up_every TEXT,
  prompts TEXT,
  category_id TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- active | paused | ended | aspiring
  started TEXT,
  next_prompt TEXT,
  ord REAL NOT NULL DEFAULT 0,
  created TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX habits_mode ON habits(mode, status);

CREATE TABLE habit_log (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  habit_id TEXT NOT NULL,
  day TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'done',     -- done | plan | skip | level | pending | answer
  count INTEGER NOT NULL DEFAULT 1,
  value TEXT,
  created TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (habit_id, day, kind)
);
CREATE INDEX habit_log_day ON habit_log(mode, day);

-- Finished work sessions.
CREATE TABLE log (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  project_id TEXT,
  date TEXT NOT NULL,
  started TEXT,
  ended TEXT,
  minutes INTEGER,
  where_stopped TEXT,
  next_action TEXT,
  created TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX log_mode_date ON log(mode, date);

CREATE TABLE skips (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  project_id TEXT NOT NULL,
  to_project_id TEXT,
  date TEXT NOT NULL,
  created TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE reminders (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  project_id TEXT,
  text TEXT,
  due TEXT NOT NULL,
  done TEXT,
  created TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX reminders_due ON reminders(mode, done, due);

CREATE TABLE whiteboards (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  project_id TEXT,
  name TEXT NOT NULL,
  show_today INTEGER NOT NULL DEFAULT 0,
  scene TEXT,                            -- Excalidraw scene JSON
  thumbnail TEXT,                        -- small data: URL
  ord REAL NOT NULL DEFAULT 0,
  created TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- A project's notes, or the body of a list with kind 'note'.
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  project_id TEXT,
  list_id TEXT,
  body TEXT NOT NULL DEFAULT '',         -- Markdown
  show_today INTEGER NOT NULL DEFAULT 0,
  created TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX notes_project ON notes(project_id) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX notes_list ON notes(list_id) WHERE list_id IS NOT NULL;

CREATE TABLE stickies (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  project_id TEXT NOT NULL,
  text TEXT,
  color TEXT,
  opacity REAL,
  x REAL, y REAL, w REAL, h REAL,
  created TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE links (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'relates',  -- blocks | relates
  note TEXT,
  created TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Which Drive file mirrors which row (Phase 4).
CREATE TABLE drive_links (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  file_id TEXT,
  drive_version TEXT,
  synced_version TEXT,
  state TEXT NOT NULL DEFAULT 'pending', -- in_sync | pending | conflict | error
  error TEXT,
  created TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (entity, entity_id)
);

-- Key/value settings per mode. mode '' holds settings for the whole deployment.
CREATE TABLE settings (
  mode TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (mode, key)
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  kind TEXT NOT NULL,                    -- reminder | habit | session | pomodoro | nudge | ...
  title TEXT NOT NULL,
  body TEXT,
  due TEXT NOT NULL,
  dedupe_key TEXT UNIQUE,
  seen_at TEXT,
  dismissed_at TEXT,
  created TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX notifications_due ON notifications(mode, dismissed_at, due);

-- Every change made through the API, grouped per request, for undo.
CREATE TABLE undo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL,
  batch TEXT NOT NULL,
  label TEXT NOT NULL,
  entity TEXT NOT NULL,
  row_id TEXT NOT NULL,
  before TEXT,                           -- JSON row, NULL when the row was created
  after TEXT,                            -- JSON row, NULL when the row was deleted
  created TEXT NOT NULL,
  undone INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX undo_batch ON undo(mode, undone, id);

CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,             -- SHA-256 of the token
  created TEXT NOT NULL,
  last_used TEXT
);

INSERT INTO modes (id, label, ord, created, updated_at) VALUES
  ('personal', 'Personal', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('work', 'Work', 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
