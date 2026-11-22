-- Settings that can now be set for every profile (DECISIONS D46) read a settings row with mode ''
-- as "the value for all profiles" when a profile has none of its own. Until now such rows were never
-- read for these keys, so any left over (a script, an old import) would suddenly start to count:
-- remove them, so every profile keeps exactly what it has. Each profile's own values stay as they are.
DELETE FROM settings WHERE mode = '' AND key IN (
  'features', 'notify', 'layout.today.view', 'nudge.hour', 'nudge.days', 'session.length', 'links.types',
  'pomodoro.work', 'pomodoro.break', 'pomodoro.long_break', 'pomodoro.rounds', 'pomodoro.breaks_pause_session',
  'swiftbar.show_pomodoro'
);
