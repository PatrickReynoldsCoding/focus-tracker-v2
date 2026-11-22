// Settings that can be set for one profile or for every profile (DECISIONS D46).
// Each such setting may have a value for all profiles (a settings row with mode '') and a
// value of a profile's own (a row with the profile's mode). What a profile uses: its own
// value if it has one, else the value for all profiles, else the setting's default.
//
// A module lists them in Module.scopedSettings. A setting is either a whole settings key
// (pomodoro.work, links.types) or one field of a JSON object key (one flag of `features`,
// one part of `notify`), so one flag can be set for every profile and another for one.
//
// Ctx.setting / Ctx.jsonSetting already give what a profile uses (they fall back to the value
// for all profiles); write through writeScoped so "All profiles" clears the profiles' own values.

import type { Ctx } from './ctx';
import { bad } from './errors';
import { allModules } from './registry';

export type Scope = 'profile' | 'all';
export const SCOPES = ['profile', 'all'] as const;

export interface ScopedSetting {
  /** Unique id: 'pomodoro.work', 'features.habits', 'notify.quiet'. */
  id: string;
  /** The settings key that holds it. */
  key: string;
  /** For a JSON object key: the field of the object. */
  field?: string;
  /** What the owner calls it. */
  label: string;
  /** The Settings section it is shown in (a settings panel id). */
  section: string;
  /** Turn a value sent by a client or Claude into what is stored (a whole key's text; a field's JSON
   *  value), or throw a 400. Null clears it. Without it any text (or JSON value) is kept as sent. */
  parse?: (value: unknown) => unknown;
  /** Runs before a value is set for every profile (throw to refuse: link types still in use). */
  beforeAll?: (ctx: Ctx, value: unknown) => Promise<void>;
}

let units: ScopedSetting[] | null = null;
let kinds: Map<string, 'whole' | 'object'> | null = null;

export function allScoped(): ScopedSetting[] {
  if (!units) {
    units = allModules().flatMap((m) => (typeof m.scopedSettings === 'function' ? m.scopedSettings() : (m.scopedSettings ?? [])));
    const seen = new Set<string>();
    for (const u of units) {
      if (seen.has(u.id)) throw new Error(`Scoped setting ${u.id} is listed twice`);
      seen.add(u.id);
    }
  }
  return units;
}

/** Whether a settings key holds one scoped setting ('whole'), fields of several ('object'), or none. */
export function keyKind(key: string): 'whole' | 'object' | null {
  if (!kinds) {
    kinds = new Map();
    for (const u of allScoped()) kinds.set(u.key, u.field ? 'object' : 'whole');
  }
  return kinds.get(key) ?? null;
}

export function scopedSetting(id: string): ScopedSetting {
  const u = allScoped().find((x) => x.id === id);
  if (!u) throw bad(`No setting "${id}" can be set for all profiles. Settings: ${allScoped().map((x) => x.id).join(', ')}`);
  return u;
}

/** The scoped setting a whole key is (for PUT /api/settings/:key), or null. */
export const wholeKey = (key: string): ScopedSetting | null => allScoped().find((u) => u.key === key && !u.field) ?? null;

export function parseScope(raw: unknown): Scope {
  if (raw === undefined || raw === null || raw === '') return 'profile';
  if (raw === 'profile' || raw === 'all') return raw;
  throw bad('scope must be "profile" (this profile only, the usual) or "all" (every profile)');
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fieldPath = (field: string) => `$."${field.replace(/"/g, '')}"`;

function object(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** What the profile uses for this setting (null: neither it nor every profile has one, so the default). */
export async function effectiveValue(ctx: Ctx, u: ScopedSetting): Promise<unknown> {
  if (!u.field) return ctx.setting(u.key);
  const merged = await ctx.jsonSetting<Record<string, unknown>>(u.key, {});
  return merged[u.field] ?? null;
}

/** Live profiles other than '' that have a value of their own for this setting. */
async function profilesWithOwn(ctx: Ctx, u: ScopedSetting): Promise<string[]> {
  const sql = u.field
    ? 'SELECT s.mode FROM settings s JOIN modes m ON m.id = s.mode WHERE s.key = ? AND json_valid(s.value) AND json_type(s.value, ?) IS NOT NULL'
    : 'SELECT s.mode FROM settings s JOIN modes m ON m.id = s.mode WHERE s.key = ?';
  const stmt = u.field ? ctx.db.prepare(sql).bind(u.key, fieldPath(u.field)) : ctx.db.prepare(sql).bind(u.key);
  return (await stmt.all<{ mode: string }>()).results.map((r) => r.mode);
}

export interface WriteResult {
  scope: Scope;
  /** With scope all: the profiles that had a value of their own, now cleared. */
  cleared: string[];
}

/**
 * Set one scoped setting. `value` is what is stored (a whole key's text, or a field's JSON value);
 * null clears it. scope 'profile' changes the profile's own value (null: the profile goes back to
 * the value for all profiles); 'all' sets the value for all profiles and clears every profile's own.
 */
export async function writeScoped(ctx: Ctx, u: ScopedSetting, value: unknown, scope: Scope): Promise<WriteResult> {
  if (u.parse && value !== null) value = u.parse(value);
  if (scope === 'profile') {
    if (!u.field) {
      await ctx.setSetting(u.key, value === null ? null : String(value));
      return { scope, cleared: [] };
    }
    const own = object(await ctx.setting(u.key));
    if (value === null) delete own[u.field];
    else {
      // The same as what the profile uses already, and not its own: nothing to keep.
      if (!(u.field in own) && same(await effectiveValue(ctx, u), value)) return { scope, cleared: [] };
      own[u.field] = value;
    }
    await ctx.setSetting(u.key, Object.keys(own).length ? JSON.stringify(own) : null);
    return { scope, cleared: [] };
  }
  if (u.beforeAll) await u.beforeAll(ctx, value);
  const cleared = await profilesWithOwn(ctx, u);
  if (!u.field) {
    await ctx.db.prepare("DELETE FROM settings WHERE mode != '' AND key = ?").bind(u.key).run();
    await ctx.setSetting(u.key, value === null ? null : String(value), '');
  } else {
    const path = fieldPath(u.field);
    await ctx.db.batch([
      ctx.db.prepare("UPDATE settings SET value = json_remove(value, ?), updated_at = ? WHERE mode != '' AND key = ? AND json_valid(value) AND json_type(value, ?) IS NOT NULL").bind(path, ctx.now(), u.key, path),
      ctx.db.prepare("DELETE FROM settings WHERE mode != '' AND key = ? AND value = '{}'").bind(u.key),
    ]);
    const all = object(await ctx.setting(u.key, ''));
    if (value === null) delete all[u.field];
    else all[u.field] = value;
    await ctx.setSetting(u.key, Object.keys(all).length ? JSON.stringify(all) : null, '');
  }
  ctx.forgetSettings();
  return { scope, cleared };
}

/** "Use the global value": the profile drops its own value of this setting. */
export async function useGlobal(ctx: Ctx, u: ScopedSetting): Promise<void> {
  await writeScoped(ctx, u, null, 'profile');
}

/** Make what this profile uses the value for every profile (clearing every profile's own). */
export async function applyToAll(ctx: Ctx, u: ScopedSetting): Promise<WriteResult> {
  // The value is stored already: keep it exactly as it is.
  return writeScoped(ctx, { ...u, parse: undefined }, await effectiveValue(ctx, u), 'all');
}

export interface ScopeState {
  id: string;
  label: string;
  section: string;
  /** What this profile uses (a whole key's text, a field's JSON value), null for the default. */
  value: unknown;
  /** This profile has a value of its own. */
  own: boolean;
  /** There is a value for all profiles. */
  global: boolean;
  /** The value for all profiles (null when none). */
  global_value: unknown;
  /** The profiles (ids) that have a value of their own. */
  profiles: string[];
}

/** Every scoped setting's state for the request's profile, in one query. */
export async function scopeStates(ctx: Ctx): Promise<ScopeState[]> {
  const list = allScoped();
  const keys = [...new Set(list.map((u) => u.key))];
  const rows = (
    await ctx.db
      .prepare(`SELECT s.mode, s.key, s.value FROM settings s WHERE s.key IN (${keys.map(() => '?').join(',')}) AND (s.mode = '' OR s.mode IN (SELECT id FROM modes))`)
      .bind(...keys)
      .all<{ mode: string; key: string; value: string }>()
  ).results;
  return list.map((u) => {
    const mine = rows.filter((r) => r.key === u.key);
    const has = (r: { value: string }) => !u.field || u.field in object(r.value);
    const valueOf = (r: { value: string } | undefined) => (r && has(r) ? (u.field ? object(r.value)[u.field] : r.value) : null);
    const globalRow = mine.find((r) => r.mode === '' && has(r));
    const ownRow = mine.find((r) => r.mode === ctx.mode && has(r));
    return {
      id: u.id,
      label: u.label,
      section: u.section,
      value: ownRow ? valueOf(ownRow) : valueOf(globalRow),
      own: !!ownRow,
      global: !!globalRow,
      global_value: valueOf(globalRow),
      profiles: mine.filter((r) => r.mode !== '' && has(r)).map((r) => r.mode),
    };
  });
}

/** A parse for a whole number setting stored as text (accepts 25 or "25"). */
export const wholeNumber =
  (min: number, max: number, what: string) =>
  (v: unknown): string => {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) throw bad(`${what} must be a whole number from ${min} to ${max}`);
    return String(n);
  };

/** A parse for an on/off setting stored as 'on' or 'off' (accepts true, false, "on", "off"). */
export const onOff =
  (what: string) =>
  (v: unknown): string => {
    if (v === true || v === 'on') return 'on';
    if (v === false || v === 'off') return 'off';
    throw bad(`${what} must be true or false`);
  };
