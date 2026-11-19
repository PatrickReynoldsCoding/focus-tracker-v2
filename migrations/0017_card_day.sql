-- A card (a project's board card or a plain list's item) can be for a day, so it shows in the
-- Today list (docs/DECISIONS.md D30). Only adds columns: existing cards keep no day.
--   day   the day it is for (empty: no day)
--   done  the day it was ticked off (a project card also moves to its board's last column)

ALTER TABLE tasks ADD COLUMN day TEXT;
ALTER TABLE tasks ADD COLUMN done TEXT;
CREATE INDEX tasks_day ON tasks(mode, day);
