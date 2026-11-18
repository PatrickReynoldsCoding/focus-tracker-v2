// The Worker brings its database up to date by itself on the first request after
// a deploy, so a one-click deploy needs no separate migration step. It uses the
// same d1_migrations table as `wrangler d1 migrations apply`, so both agree.

import m0001 from '../../migrations/0001_init.sql';
import m0005 from '../../migrations/0005_resource_kind.sql';

/** Every migration, in order. A new file in migrations/ needs a line here (a test checks). */
export const MIGRATIONS: [name: string, sql: string][] = [
  ['0001_init.sql', m0001],
  ['0005_resource_kind.sql', m0005],
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
