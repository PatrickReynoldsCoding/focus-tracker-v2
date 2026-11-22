// Profiles: what the app calls modes (Personal, Work ...). The database and API keep the name
// `mode` (the `modes` table, X-Mode, every tool's `mode` argument); this module adds what the
// profile menu needs (DECISIONS D35):
//   - a new profile starts with the usual settings, or a copy of another profile's settings
//     (switches, notifications, layouts and pills, pomodoro ...; never its data or its state),
//   - renaming, recolouring and reordering (also the generic PATCH /api/modes/:id and
//     POST /api/modes/:id/move),
//   - deleting a profile with everything in it: the caller sends the profile's name; the
//     profile is put aside (table deleted_modes, its rows stay) and can be restored for
//     RESTORE_DAYS days, then it is purged for good (the hourly cron, or Delete now),
//   - the default profile (used when a client or Claude names none). While profiles.follow_open
//     is on (the usual), opening a profile in the app makes it the default, so the Mac menu bar
//     and the Android widgets follow the app (v0.25.0); turned off, the chosen default stays.

import { z } from 'zod';
import type { Ctx } from '../core/ctx';
import { ApiError, bad } from '../core/errors';
import { allEntities, allModules, type Module } from '../core/registry';
import { create, get, list, move, update } from '../core/store';
import { modesEntity } from './basics';
import { cleanGrid, cleanPills } from './layout';

/** Settings kept once for the whole tracker (settings rows with mode ''), not per profile. */
export const GLOBAL_SETTINGS = ['timezone', 'default_mode', 'profiles.follow_open'] as const;

/** Settings that were global until v0.30.0 and are per profile now (migration 0021). */
export const PER_PROFILE_SETTINGS = ['features', 'notify', 'session.length', 'links.types'] as const;

/** A profile's own state or data, not a preference: never copied to a new profile. The usual
 *  rotation names categories, which are the other profile's data. */
const NOT_COPIED = /^(session\.current$|pomodoro\.current$|nottoday$|focus\.|rotation\.|week\.|next\.)/;

/** Tables with a `mode` column that are not entities, cleared when a profile is purged. */
const OTHER_MODE_TABLES = ['settings', 'undo'];

/** How long a deleted profile can be restored. */
export const RESTORE_DAYS = 7;

const COLOUR = /^#[0-9a-fA-F]{6}$/;
const missing = (message: string) => new ApiError(404, message);
const LABEL_MAX = 40;
const FOLLOW_KEY = 'profiles.follow_open';

export const modeTables = (): string[] => [...new Set([...allEntities().filter((e) => e.modeScoped).map((e) => e.table), ...OTHER_MODE_TABLES])];

export type Profile = { id: string; label: string; color: string | null; ord: number };
type Deleted = { id: string; label: string; color: string | null; deleted_at: string; restore_until: string };

const shape = (r: Record<string, unknown>): Profile => ({ id: String(r.id), label: String(r.label), color: (r.color as string) || null, ord: Number(r.ord) });

async function liveProfiles(ctx: Ctx): Promise<Profile[]> {
  return (await list(ctx, modesEntity)).map(shape);
}

export async function defaultProfile(ctx: Ctx): Promise<string> {
  const chosen = await ctx.setting('default_mode', '');
  const all = await liveProfiles(ctx);
  return all.find((m) => m.id === chosen)?.id ?? all.find((m) => m.id === 'personal')?.id ?? all[0]?.id ?? 'personal';
}

const follows = async (ctx: Ctx) => (await ctx.setting(FOLLOW_KEY, '')) !== 'off';

async function deletedProfiles(ctx: Ctx): Promise<Deleted[]> {
  const rows = (await ctx.db.prepare('SELECT id, row, deleted_at FROM deleted_modes ORDER BY deleted_at DESC').all<{ id: string; row: string; deleted_at: string }>()).results;
  return rows.map((r) => {
    const row = JSON.parse(r.row) as Record<string, unknown>;
    const until = new Date(Date.parse(r.deleted_at) + RESTORE_DAYS * 86400_000).toISOString();
    return { id: r.id, label: String(row.label), color: (row.color as string) || null, deleted_at: r.deleted_at, restore_until: until };
  });
}

export async function listProfiles(ctx: Ctx) {
  await purgeExpired(ctx.db, ctx.nowDate);
  return {
    default: await defaultProfile(ctx),
    current: ctx.mode,
    follow_open: await follows(ctx),
    profiles: await liveProfiles(ctx),
    deleted: await deletedProfiles(ctx),
    global_settings: GLOBAL_SETTINGS,
  };
}

// ---------- copying settings ----------

/** Panel ids that name a file (a note, list or whiteboard on Today): data, so left out of a copy. */
function filePanel(id: string): boolean {
  const prefixes = allModules().flatMap((m) => (m.files ?? []).map((f) => f.today?.prefix).filter((p): p is string => !!p));
  return prefixes.some((p) => id.startsWith(p));
}

/** A layout setting with the file panels taken out (they belong to the other profile's data). */
function withoutFiles(key: string, raw: string): string {
  try {
    const v = JSON.parse(raw);
    const grid = (g: unknown) => {
      const c = cleanGrid(g);
      for (const id of Object.keys(c.items)) if (filePanel(id)) delete c.items[id];
      c.removed = c.removed.filter((id) => !filePanel(id));
      return c;
    };
    if (key.endsWith('.pills')) return JSON.stringify(cleanPills({ pills: v }).map((p) => ({ ...p, panels: p.panels.filter((id) => !filePanel(id)) })));
    if (key.endsWith('.grids')) return JSON.stringify(Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, g]) => [k, grid(g)])));
    if (key.endsWith('.view')) return raw;
    return JSON.stringify(grid(v));
  } catch {
    return raw; // not ours to judge: copy it as it is
  }
}

/** Copy one profile's settings to another (replacing the target's). Returns the keys copied. */
export async function copySettings(ctx: Ctx, from: string, to: string): Promise<string[]> {
  const rows = (await ctx.db.prepare('SELECT key, value FROM settings WHERE mode = ?').bind(from).all<{ key: string; value: string }>()).results;
  const keep = rows.filter((r) => !NOT_COPIED.test(r.key));
  if (!keep.length) return [];
  const stmt = ctx.db.prepare(
    'INSERT INTO settings (mode, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (mode, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  );
  await ctx.db.batch(keep.map((r) => stmt.bind(to, r.key, r.key.startsWith('layout.') ? withoutFiles(r.key, r.value) : r.value, ctx.now())));
  return keep.map((r) => r.key);
}

// ---------- making and changing ----------

async function exists(ctx: Ctx, id: string) {
  return !!(await ctx.db.prepare('SELECT 1 FROM modes WHERE id = ?').bind(id).first());
}

function checkLabel(raw: unknown): string {
  const label = typeof raw === 'string' ? raw.trim() : '';
  if (!label) throw bad('A profile needs a name');
  if ([...label].length > LABEL_MAX) throw bad(`A profile's name is at most ${LABEL_MAX} characters`);
  return label;
}

function checkColour(raw: unknown): string | null {
  const color = raw == null || raw === '' ? null : String(raw);
  if (color && !COLOUR.test(color)) throw bad('color must look like #3366cc');
  return color;
}

export async function createProfile(ctx: Ctx, input: { label?: unknown; color?: unknown; copy_from?: unknown }) {
  const label = checkLabel(input.label);
  const color = checkColour(input.color);
  const from = input.copy_from == null || input.copy_from === '' ? null : String(input.copy_from);
  if (from && !(await exists(ctx, from))) throw bad(`No profile "${from}" to copy settings from`);
  const row = await create(ctx, modesEntity, { label, color });
  // Not undoable: undoing it would leave the profile's settings behind, and a device inside a profile that is gone.
  ctx.changes.length = 0;
  const copied = from ? await copySettings(ctx, from, row.id) : [];
  return { profile: shape(row), copied_from: from, settings_copied: copied.length };
}

export async function updateProfile(ctx: Ctx, id: string, input: { label?: unknown; color?: unknown; position?: unknown }) {
  const patch: Record<string, unknown> = {};
  if (input.label !== undefined) patch.label = checkLabel(input.label);
  if (input.color !== undefined) patch.color = checkColour(input.color) ?? '';
  let row = Object.keys(patch).length ? await update(ctx, modesEntity, id, patch) : await get(ctx, modesEntity, id);
  if (input.position !== undefined) {
    if (typeof input.position !== 'number' || !Number.isInteger(input.position) || input.position < 1) throw bad('position is a whole number from 1 (first)');
    row = await move(ctx, modesEntity, id, { index: input.position - 1 });
  }
  return shape(row);
}

export async function setDefaultProfile(ctx: Ctx, id: string) {
  if (!(await exists(ctx, id))) throw missing(`No profile "${id}"`);
  await ctx.setSetting('default_mode', id, '');
  return listProfiles(ctx);
}

/** The app opened a profile: it becomes the default while follow_open is on. */
export async function profileOpened(ctx: Ctx, id: string) {
  if (!(await exists(ctx, id))) throw missing(`No profile "${id}"`);
  const follow = await follows(ctx);
  if (follow) await ctx.setSetting('default_mode', id, '');
  return { default: await defaultProfile(ctx), follow_open: follow };
}

export async function setFollowOpen(ctx: Ctx, on: boolean) {
  await ctx.setSetting(FOLLOW_KEY, on ? null : 'off', '');
  return listProfiles(ctx);
}

// ---------- deleting, restoring, purging ----------

/** How much a profile holds, by kind, for the warning before deleting it. */
export async function profileUsage(ctx: Ctx, id: string): Promise<{ kind: string; singular: string; count: number }[]> {
  // In module order: each module's tables, then its old kinds kept as aliases (to-dos are cards, D40), counted apart as before.
  const kinds = allModules().flatMap((m) => [
    ...(m.entities ?? []).filter((e) => e.modeScoped && !e.internal).map((e) => ({ kind: e.name, singular: e.singular, count: () => countRows(ctx, e.table, id) })),
    ...(m.aliases ?? []).map((a) => ({ kind: a.name, singular: a.singular, of: a.of, count: () => a.count(ctx, id) })),
  ]);
  const out = await Promise.all(kinds.map(async (k) => ({ kind: k.kind, singular: k.singular, count: await k.count() })));
  for (const [i, k] of kinds.entries()) {
    const of = 'of' in k ? out.find((x) => x.kind === k.of) : null;
    if (of) of.count -= out[i].count;
  }
  return out.filter((x) => x.count > 0);
}

async function countRows(ctx: Ctx, table: string, mode: string): Promise<number> {
  return (await ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE mode = ?`).bind(mode).first<{ n: number }>())?.n ?? 0;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export async function deleteProfile(ctx: Ctx, id: string, confirm: unknown) {
  const raw = await ctx.db.prepare('SELECT * FROM modes WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!raw) throw missing(`No profile "${id}"`);
  const label = String(raw.label);
  const count = await ctx.db.prepare('SELECT COUNT(*) AS n FROM modes').first<{ n: number }>();
  if ((count?.n ?? 0) <= 1) throw bad('The last profile cannot be deleted');
  if (typeof confirm !== 'string' || !sameName(confirm, label))
    throw new ApiError(400, `To delete the profile and everything in it, send its name (${label}) as confirm`, 'confirm_needed');
  const wasDefault = (await defaultProfile(ctx)) === id;
  const usage = await profileUsage(ctx, id);
  // Its rows stay where they are; with no row in `modes` nothing can reach them until it is restored.
  await ctx.db.batch([
    ctx.db.prepare('INSERT OR REPLACE INTO deleted_modes (id, row, was_default, deleted_at) VALUES (?, ?, ?, ?)').bind(id, JSON.stringify(raw), wasDefault ? 1 : 0, ctx.now()),
    ctx.db.prepare('DELETE FROM modes WHERE id = ?').bind(id),
  ]);
  if (ctx.mode === id) ctx.changes.length = 0; // its undo history is put aside with it
  const next = await defaultProfile(ctx);
  if (wasDefault) await ctx.setSetting('default_mode', next, '');
  return { deleted: id, label, removed: usage, default: next, restore_until: new Date(ctx.nowDate.getTime() + RESTORE_DAYS * 86400_000).toISOString() };
}

export async function restoreProfile(ctx: Ctx, id: string) {
  const r = await ctx.db.prepare('SELECT row, was_default FROM deleted_modes WHERE id = ?').bind(id).first<{ row: string; was_default: number }>();
  if (!r) throw missing(`No deleted profile "${id}" (after ${RESTORE_DAYS} days it is gone for good)`);
  const row = JSON.parse(r.row) as Record<string, unknown>;
  if (await exists(ctx, id)) throw bad(`There is a profile with the id ${id} already`);
  // A profile made since with the same name: this one comes back as "Name (restored)".
  const clash = await ctx.db.prepare('SELECT 1 FROM modes WHERE lower(trim(label)) = lower(trim(?))').bind(String(row.label)).first();
  if (clash) row.label = `${String(row.label).slice(0, LABEL_MAX - 11)} (restored)`;
  const cols = ['id', 'label', 'color', 'ord', 'created', 'updated_at'];
  row.updated_at = ctx.now();
  await ctx.db.batch([
    ctx.db.prepare(`INSERT INTO modes (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).bind(...cols.map((c) => row[c] ?? null)),
    ctx.db.prepare('DELETE FROM deleted_modes WHERE id = ?').bind(id),
  ]);
  if (r.was_default) await ctx.setSetting('default_mode', id, '');
  return { restored: shape(row), default: await defaultProfile(ctx) };
}

/** Remove a deleted profile's rows for good. */
async function purge(db: D1Database, id: string): Promise<void> {
  await db.batch([...modeTables().map((t) => db.prepare(`DELETE FROM ${t} WHERE mode = ?`).bind(id)), db.prepare('DELETE FROM deleted_modes WHERE id = ?').bind(id)]);
}

export async function purgeProfile(ctx: Ctx, id: string, confirm: unknown) {
  const r = await ctx.db.prepare('SELECT row FROM deleted_modes WHERE id = ?').bind(id).first<{ row: string }>();
  if (!r) throw missing(`No deleted profile "${id}"`);
  const label = String((JSON.parse(r.row) as Record<string, unknown>).label);
  if (typeof confirm !== 'string' || !sameName(confirm, label)) throw new ApiError(400, `To delete ${label} for good now, send its name as confirm`, 'confirm_needed');
  await purge(ctx.db, id);
  return { purged: id, label };
}

/** Purge the profiles deleted more than RESTORE_DAYS days ago (the hourly cron, and listing). */
export async function purgeExpired(db: D1Database, now = new Date()): Promise<string[]> {
  const before = new Date(now.getTime() - RESTORE_DAYS * 86400_000).toISOString();
  const old = (await db.prepare('SELECT id FROM deleted_modes WHERE deleted_at < ?').bind(before).all<{ id: string }>()).results;
  for (const o of old) await purge(db, o.id);
  return old.map((o) => o.id);
}

// ---------- the module ----------

const idArg = z.string().describe('The profile’s id, such as "personal" (list_profiles gives them)');
const body = async <T>(c: { req: { json: () => Promise<unknown> } }) => ((await c.req.json().catch(() => ({}))) ?? {}) as T;

export const profilesModule: Module = {
  id: 'profiles',
  description: 'Profiles (modes): make one with copied settings, rename, reorder, delete with everything in it (restorable for a week), the default profile.',
  routes(api) {
    api.get('/profiles', async (c) => c.json(await listProfiles(c.get('ctx'))));
    api.post('/profiles', async (c) => c.json(await createProfile(c.get('ctx'), await body(c)), 201));
    api.put('/profiles/default', async (c) => c.json(await setDefaultProfile(c.get('ctx'), String((await body<{ id?: string }>(c)).id ?? ''))));
    api.put('/profiles/follow-open', async (c) => {
      const { on } = await body<{ on?: unknown }>(c);
      if (typeof on !== 'boolean') throw bad('on must be true or false');
      return c.json(await setFollowOpen(c.get('ctx'), on));
    });
    api.post('/profiles/opened', async (c) => c.json(await profileOpened(c.get('ctx'), String((await body<{ id?: string }>(c)).id ?? ''))));
    api.patch('/profiles/:id', async (c) => c.json(await updateProfile(c.get('ctx'), c.req.param('id'), await body(c))));
    api.get('/profiles/:id/usage', async (c) => {
      const ctx = c.get('ctx');
      if (!(await exists(ctx, c.req.param('id')))) throw missing(`No profile "${c.req.param('id')}"`);
      return c.json(await profileUsage(ctx, c.req.param('id')));
    });
    api.post('/profiles/:id/delete', async (c) => c.json(await deleteProfile(c.get('ctx'), c.req.param('id'), (await body<{ confirm?: string }>(c)).confirm)));
    api.post('/profiles/:id/restore', async (c) => c.json(await restoreProfile(c.get('ctx'), c.req.param('id'))));
    api.post('/profiles/:id/purge', async (c) => c.json(await purgeProfile(c.get('ctx'), c.req.param('id'), (await body<{ confirm?: string }>(c)).confirm)));
  },
  tools: [
    {
      name: 'list_profiles',
      description: 'List the profiles (called modes in other tools: pass a profile’s id as `mode`) with their colours, the default one, and profiles deleted in the last week that can still be restored.',
      readOnly: true,
      input: z.object({}),
      run: (ctx) => listProfiles(ctx),
    },
    {
      name: 'create_profile',
      description: 'Make a new profile. It starts with the usual settings, or with a copy of another profile’s settings (feature switches, notifications, layouts and pills, pomodoro; never its data) when copy_from is given.',
      input: z.object({
        label: z.string().describe('Its name, such as "Side projects"'),
        color: z.string().optional().describe('Colour theme as #rrggbb'),
        copy_from: z.string().optional().describe('Id of the profile whose settings to copy'),
      }),
      run: (ctx, a) => createProfile(ctx, a),
    },
    {
      name: 'update_profile',
      description: 'Rename a profile, change its colour ("" for the usual one) or its place in the list (1 = first).',
      input: z.object({ id: idArg, label: z.string().optional(), color: z.string().optional(), position: z.number().int().min(1).optional() }),
      run: (ctx, a) => updateProfile(ctx, a.id, a),
    },
    {
      name: 'set_default_profile',
      description: 'Choose the profile used when a device or a tool names none. Opening another profile in the app changes it again, unless the owner turned that off in Manage profiles.',
      input: z.object({ id: idArg }),
      run: (ctx, a) => setDefaultProfile(ctx, a.id),
    },
    {
      name: 'delete_profile',
      description: `Delete a profile and everything in it (projects, notes, habits, settings). Only when the owner asks, and pass the profile’s name as confirm_name. It can be restored with restore_profile for ${RESTORE_DAYS} days; then it is gone. The last profile cannot be deleted.`,
      input: z.object({ id: idArg, confirm_name: z.string().describe('The profile’s name, exactly as the owner sees it') }),
      run: (ctx, a) => deleteProfile(ctx, a.id, a.confirm_name),
    },
    {
      name: 'restore_profile',
      description: `Bring back a profile deleted in the last ${RESTORE_DAYS} days, with everything that was in it (list_profiles shows them under deleted).`,
      input: z.object({ id: idArg }),
      run: (ctx, a) => restoreProfile(ctx, a.id),
    },
  ],
};
