// The Worker brings its database up to date by itself on the first request after
// a deploy, so a one-click deploy needs no separate migration step. It uses the
// same d1_migrations table as `wrangler d1 migrations apply`, so both agree.

import m0001 from '../../migrations/0001_init.sql';
import m0003 from '../../migrations/0003_issue_links.sql';
import m0006 from '../../migrations/0006_mode_colour.sql';
import m0008 from '../../migrations/0008_today_panels.sql';
import m0010 from '../../migrations/0010_resource_kind.sql';
import m0012 from '../../migrations/0012_whiteboard_scenes.sql';
import m0016 from '../../migrations/0016_drop_unused.sql';
import m0017 from '../../migrations/0017_card_day.sql';
import m0018 from '../../migrations/0018_files.sql';
import m0019 from '../../migrations/0019_done_column.sql';
import m0020 from '../../migrations/0020_habit_project.sql';
import m0021 from '../../migrations/0021_profile_settings.sql';
import m0022 from '../../migrations/0022_unified_todos.sql';
import m0023 from '../../migrations/0023_tags.sql';
import m0024 from '../../migrations/0024_setting_scope.sql';
import m0025 from '../../migrations/0025_projects_tree.sql';
import m0026 from '../../migrations/0026_habit_notes.sql';
import m0027 from '../../migrations/0027_subtasks.sql';
import m0028 from '../../migrations/0028_profile_theme.sql';
import m0029 from '../../migrations/0029_today_stickies.sql';
import m0030 from '../../migrations/0030_focus_queue.sql';

/** Every migration, in order. A new file in migrations/ needs a line here (a test checks). */
export const MIGRATIONS: [name: string, sql: string][] = [
  ['0001_init.sql', m0001],
  ['0003_issue_links.sql', m0003],
  ['0006_mode_colour.sql', m0006],
  ['0008_today_panels.sql', m0008],
  ['0010_resource_kind.sql', m0010],
  ['0012_whiteboard_scenes.sql', m0012],
  ['0016_drop_unused.sql', m0016],
  ['0017_card_day.sql', m0017],
  ['0018_files.sql', m0018],
  ['0019_done_column.sql', m0019],
  ['0020_habit_project.sql', m0020],
  ['0021_profile_settings.sql', m0021],
  ['0022_unified_todos.sql', m0022],
  ['0023_tags.sql', m0023],
  ['0024_setting_scope.sql', m0024],
  ['0025_projects_tree.sql', m0025],
  ['0026_habit_notes.sql', m0026],
  ['0027_subtasks.sql', m0027],
  ['0028_profile_theme.sql', m0028],
  ['0029_today_stickies.sql', m0029],
  ['0030_focus_queue.sql', m0030],
];

let done = false;

export function statements(sql: string): string[] {
  return sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function ensureMigrated(db: D1Database): Promise<void> {
  if (done) return;
  await db.prepare('CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)').run();
  const applied = new Set((await db.prepare('SELECT name FROM d1_migrations').all<{ name: string }>()).results.map((r) => r.name));
  for (const [name, sql] of MIGRATIONS) {
    if (applied.has(name)) continue;
    await db.batch([...statements(sql).map((s) => db.prepare(s)), db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(name)]);
  }
  done = true;
}
