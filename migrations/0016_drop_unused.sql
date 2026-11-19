-- Drops what nothing uses any more (docs/DECISIONS.md D11, D12, D14):
-- the Google Drive sync tables and their columns, the next-action columns, and the
-- old whiteboard drawing column (migration 0012 moved the drawings to whiteboard_scenes).
-- None of these columns is in an index, view, trigger or key, so DROP COLUMN works in D1.
-- Old undo rows may still hold the dropped columns; undo restores only columns that exist.

DELETE FROM undo WHERE entity IN ('accounts', 'drive_links');

DROP TABLE drive_links;
DROP TABLE accounts;

ALTER TABLE modes DROP COLUMN account_id;
ALTER TABLE modes DROP COLUMN drive_folder_id;
ALTER TABLE categories DROP COLUMN account_id;
ALTER TABLE categories DROP COLUMN drive_folder_id;
ALTER TABLE projects DROP COLUMN next_action;
ALTER TABLE projects DROP COLUMN show_next_action;
ALTER TABLE log DROP COLUMN next_action;
ALTER TABLE whiteboards DROP COLUMN scene;
