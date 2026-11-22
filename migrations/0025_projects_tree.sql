-- Files: the top level shows one folder, Projects, with a folder per category and each project's
-- folder in its category's folder (DECISIONS D52). Those folders are worked out when read, not
-- stored. A project's folder is always shown in its category's folder, so one the owner had moved
-- into a folder of their own is put back at the top of the table (parent_id NULL); its id, name and
-- what is in it stay the same. (Production had none.)
UPDATE folders SET parent_id = NULL WHERE project_id IS NOT NULL AND parent_id IS NOT NULL;

-- Tags (D53): a project's notes have tags of their own, apart from the project's. Until now the
-- only way to tag a project was through its notes, so those tags move to the notes (kind
-- 'project-notes', same target id: the project's). (Production had none.)
UPDATE tag_links SET kind = 'project-notes' WHERE kind = 'projects';
