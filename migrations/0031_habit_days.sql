-- Habits: the weekdays a habit shows on Today ("tue,thu"; NULL = every day) (DECISIONS D68). Additive:
-- existing habits keep showing every day.
ALTER TABLE habits ADD COLUMN days TEXT;
