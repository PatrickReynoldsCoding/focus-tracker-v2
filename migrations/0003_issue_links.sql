-- Issue links (Jira-style relationships) between any two items, not only projects.
-- The links table keeps its rows: each end gains a kind ('projects', 'tasks', 'todos',
-- 'backlog', 'lists'). Old rows were project to project, so the default is 'projects'.
-- Link types (blocks, relates, duplicates ...) are checked in src/modules/relations.ts.
ALTER TABLE links ADD COLUMN from_kind TEXT NOT NULL DEFAULT 'projects';
ALTER TABLE links ADD COLUMN to_kind TEXT NOT NULL DEFAULT 'projects';
CREATE INDEX links_from ON links(mode, from_kind, from_id);
CREATE INDEX links_to ON links(mode, to_kind, to_id);
CREATE INDEX links_type ON links(mode, type);
