// The context of one request: who, which mode, what time, and the changes
// made so far (recorded for undo when the request ends).

import { bad } from './errors';
import { newId } from './ids';

export interface Env {
  DB: D1Database;
  OAUTH_KV: KVNamespace;
  ASSETS?: Fetcher;
  OWNER_PASSWORD: string;
  SESSION_SECRET: string;
  /** Set when the instance should use a fixed public URL (otherwise the request's origin). */
  PUBLIC_URL?: string;
}

export interface Change {
  entity: string;
  table: string;
  rowId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

const DEFAULT_TZ = 'Europe/London';

export class Ctx {
  readonly db: D1Database;
  readonly changes: Change[] = [];
  readonly batch = newId(12);
  readonly nowDate: Date;
  label = 'change';
  private tz?: string;
  private settingsCache = new Map<string, string | null>();

  constructor(
    readonly env: Env,
    readonly mode: string,
    now?: Date,
  ) {
    this.db = env.DB;
    this.nowDate = now ?? new Date();
  }

  now(): string {
    return this.nowDate.toISOString();
  }

  async timezone(): Promise<string> {
    if (!this.tz) this.tz = (await this.setting('timezone', '')) || DEFAULT_TZ;
    return this.tz;
  }

  /** Today's date in the owner's time zone, as 2026-11-18. */
  async today(): Promise<string> {
    return dayIn(this.nowDate, await this.timezone());
  }

  async setting(key: string, mode: string = this.mode): Promise<string | null> {
    const k = `${mode}\u0000${key}`;
    if (!this.settingsCache.has(k)) {
      const row = await this.db
        .prepare('SELECT value FROM settings WHERE mode = ? AND key = ?')
        .bind(mode, key)
        .first<{ value: string | null }>();
      this.settingsCache.set(k, row?.value ?? null);
    }
    return this.settingsCache.get(k) ?? null;
  }

  async setSetting(key: string, value: string | null, mode: string = this.mode): Promise<void> {
    if (value === null) {
      await this.db.prepare('DELETE FROM settings WHERE mode = ? AND key = ?').bind(mode, key).run();
    } else {
      await this.db
        .prepare(
          'INSERT INTO settings (mode, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (mode, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
        )
        .bind(mode, key, value, this.now())
        .run();
    }
    this.settingsCache.set(`${mode}\u0000${key}`, value);
  }

  async jsonSetting<T>(key: string, fallback: T, mode: string = this.mode): Promise<T> {
    const raw = await this.setting(key, mode);
    if (raw == null || raw === '') return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  /** Whether a feature flag is on (src/core/features.ts). */
  async feature(id: string): Promise<boolean> {
    return (await import('./features')).isOn(this, id);
  }

  /** Write the changes of this request to the undo history. */
  async flushUndo(): Promise<void> {
    if (!this.changes.length) return;
    // A new change ends what could be redone in this mode.
    await this.db.prepare('DELETE FROM undo WHERE mode = ? AND undone = 1').bind(this.mode).run();
    const stmt = this.db.prepare(
      'INSERT INTO undo (mode, batch, label, entity, row_id, before, after, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    await this.db.batch(
      this.changes.map((c) =>
        stmt.bind(
          this.mode,
          this.batch,
          this.label,
          c.entity,
          c.rowId,
          c.before ? JSON.stringify(c.before) : null,
          c.after ? JSON.stringify(c.after) : null,
          this.now(),
        ),
      ),
    );
    this.changes.length = 0;
  }
}

export function dayIn(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function weekdayIn(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long' }).format(date).toLowerCase();
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function checkDay(value: unknown, field = 'day'): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw bad(`${field} must be a date like 2026-11-18`);
  return value;
}
