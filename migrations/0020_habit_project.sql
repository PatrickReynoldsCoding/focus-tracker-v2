-- A habit can be linked to one project (it then shows on that project's page).
ALTER TABLE habits ADD COLUMN project_id TEXT;
CREATE INDEX IF NOT EXISTS idx_habits_project ON habits(project_id);
