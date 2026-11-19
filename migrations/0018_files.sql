-- Files (docs/DECISIONS.md D31): folders, and a folder for each file-like row. Every project
-- gets its own folder (project_id set), and the lists, whiteboards and resources of a project go
-- into it, so the Files tab shows them in the right place from the start. Only adds a table and
-- columns and fills them in: no existing value changes.

CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_id TEXT,                        -- NULL = top level
  project_id TEXT,                       -- set on a project's own folder
  created TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX folders_mode ON folders(mode, parent_id);
CREATE UNIQUE INDEX folders_project ON folders(project_id) WHERE project_id IS NOT NULL;

ALTER TABLE lists ADD COLUMN folder_id TEXT;
ALTER TABLE whiteboards ADD COLUMN folder_id TEXT;
ALTER TABLE resources ADD COLUMN folder_id TEXT;
CREATE INDEX lists_folder ON lists(folder_id);
CREATE INDEX whiteboards_folder ON whiteboards(folder_id);
CREATE INDEX resources_folder ON resources(folder_id);

-- A folder for every project, in the project's mode.
INSERT INTO folders (id, mode, name, parent_id, project_id, created, updated_at)
  SELECT 'pf-' || id, mode, name, NULL, id, created, updated_at FROM projects
  WHERE id NOT IN (SELECT project_id FROM folders WHERE project_id IS NOT NULL);

-- A project's files go into its folder.
UPDATE lists SET folder_id = (SELECT f.id FROM folders f WHERE f.project_id = lists.project_id) WHERE project_id IS NOT NULL AND folder_id IS NULL;
UPDATE whiteboards SET folder_id = (SELECT f.id FROM folders f WHERE f.project_id = whiteboards.project_id) WHERE project_id IS NOT NULL AND folder_id IS NULL;
UPDATE resources SET folder_id = (SELECT f.id FROM folders f WHERE f.project_id = resources.project_id) WHERE project_id IS NOT NULL AND folder_id IS NULL;
