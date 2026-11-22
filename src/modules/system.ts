// Settings, undo, API tokens and the generic tools Claude can use on any kind of row.

import { z } from 'zod';
import type { Ctx } from '../core/ctx';
import { bad } from '../core/errors';
import { newId, randomToken, sha256Hex } from '../core/ids';
import { alias, allAliases, allEntities, entity, type Module } from '../core/registry';
import { create, kindOps, redoLast, undoLast } from '../core/store';
import { allFeatures, featureStates, setFeature } from '../core/features';
import { parseScope, wholeKey, writeScoped, type Scope } from '../core/setting-scope';
import { PER_PROFILE_SETTINGS } from './profiles';

/** Settings a client may not write directly (they have their own calls). */
const PROTECTED = /^(session\.current|focus\.)/;

export async function allSettings(ctx: Ctx) {
  const rows = (
    await ctx.db.prepare("SELECT mode, key, value FROM settings WHERE mode IN (?, '') ORDER BY key").bind(ctx.mode).all<{ mode: string; key: string; value: string }>()
  ).results;
  const out: { global: Record<string, string>; mode: Record<string, string> } = { global: {}, mode: {} };
  for (const r of rows) (r.mode ? out.mode : out.global)[r.key] = r.value;
  return out;
}

export async function putSetting(ctx: Ctx, key: string, value: string | null, global = false, scope: Scope = 'profile') {
  if (!/^[a-z0-9_.-]{1,80}$/i.test(key)) throw bad('Setting keys are letters, digits, dots, dashes and underscores');
  if (PROTECTED.test(key)) throw bad(`${key} is changed through its own call`);
  // A setting that can be set for one profile or for all (D46) goes through the scoped writer.
  const scoped = wholeKey(key);
  if (scope === 'all' && !scoped) throw bad(`${key} cannot be set for all profiles`);
  if (scoped && global) throw bad(`${key} belongs to each profile: send scope "all" to set it for every profile`);
  if (scoped) {
    const r = await writeScoped(ctx, scoped, value, scope);
    return { key, value: await ctx.setting(key), global: false, scope, cleared: r.cleared };
  }
  if (key === 'timezone') {
    if (!global) throw bad('timezone is a global setting');
    try {
      new Intl.DateTimeFormat('en', { timeZone: value ?? undefined });
    } catch {
      throw bad(`Unknown time zone ${value}`);
    }
  }
  if (key === 'default_mode') {
    if (!global) throw bad('default_mode is a global setting');
    if (!value || !(await ctx.db.prepare('SELECT 1 FROM modes WHERE id = ?').bind(value).first())) throw bad(`No profile "${value}"`);
  }
  if (global && (PER_PROFILE_SETTINGS as readonly string[]).includes(key)) throw bad(`${key} belongs to each profile: send it without global`);
  await ctx.setSetting(key, value, global ? '' : ctx.mode);
  return { key, value, global };
}

export async function createToken(ctx: Ctx, name: string) {
  const token = `ft_${randomToken(24)}`;
  const id = newId();
  await ctx.db.prepare('INSERT INTO api_tokens (id, name, hash, created) VALUES (?, ?, ?, ?)').bind(id, name, await sha256Hex(token), ctx.now()).run();
  return { id, name, token };
}

const kinds = () => allEntities().filter((e) => !e.internal);
const kindNames = () => kinds().map((e) => e.name);

export const systemModule: Module = {
  id: 'system',
  description: 'Settings, undo, API tokens and generic access to every kind of row.',
  routes(api) {
    api.get('/settings', async (c) => c.json(await allSettings(c.get('ctx'))));
    api.put('/settings/:key', async (c) => {
      const b = await c.req.json<{ value: string | null; global?: boolean; scope?: string }>();
      return c.json(await putSetting(c.get('ctx'), c.req.param('key'), b.value ?? null, !!b.global, parseScope(b.scope ?? c.req.query('scope'))));
    });
    api.post('/undo', async (c) => c.json((await undoLast(c.get('ctx'))) ?? { label: null, changes: 0 }));
    api.post('/redo', async (c) => c.json((await redoLast(c.get('ctx'))) ?? { label: null, changes: 0 }));
    api.get('/tokens', async (c) => c.json((await c.get('ctx').db.prepare('SELECT id, name, created, last_used FROM api_tokens ORDER BY created').all()).results));
    api.post('/tokens', async (c) => {
      const { name } = await c.req.json<{ name: string }>();
      if (!name) throw bad('A token needs a name, such as "Android phone"');
      return c.json(await createToken(c.get('ctx'), name));
    });
    api.delete('/tokens/:id', async (c) => {
      await c.get('ctx').db.prepare('DELETE FROM api_tokens WHERE id = ?').bind(c.req.param('id')).run();
      return c.json({ ok: true });
    });
    // Apps connected through OAuth (Claude). Revoking one ends its access at once.
    api.get('/connections', async (c) => {
      const oauth = (c.env as unknown as { OAUTH_PROVIDER?: import('@cloudflare/workers-oauth-provider').OAuthHelpers }).OAUTH_PROVIDER;
      if (!oauth) return c.json([]);
      const grants = (await oauth.listUserGrants('owner')).items;
      const out = [];
      for (const g of grants) {
        const client = await oauth.lookupClient(g.clientId).catch(() => null);
        out.push({ id: g.id, client: client?.clientName ?? g.clientId, created: new Date(g.createdAt > 1e12 ? g.createdAt : g.createdAt * 1000).toISOString(), redirect: g.redirectUri ?? null });
      }
      return c.json(out);
    });
    api.delete('/connections/:id', async (c) => {
      const oauth = (c.env as unknown as { OAUTH_PROVIDER?: import('@cloudflare/workers-oauth-provider').OAuthHelpers }).OAUTH_PROVIDER;
      if (!oauth) throw bad('OAuth is not available');
      await oauth.revokeGrant(c.req.param('id'), 'owner');
      return c.json({ ok: true });
    });
    // Bulk import (Phase 5, scripts/import-v1.mjs). Rows keep their ids; a row whose id exists is skipped,
    // so an import can be run again. Not recorded for undo.
    api.post('/import/:kind', async (c) => {
      const ctx = c.get('ctx');
      const a = alias(c.req.param('kind'));
      const e = entity(a ? a.of : c.req.param('kind'));
      if (e.name === 'modes') throw bad(`${e.name} cannot be imported`);
      const { rows } = await c.req.json<{ rows: Record<string, unknown>[] }>();
      if (!Array.isArray(rows) || rows.length > 500) throw bad('Send rows as an array of at most 500');
      const out = { created: 0, skipped: 0, errors: [] as { id: unknown; error: string }[] };
      for (const row of rows) {
        try {
          if (typeof row.id === 'string' && (await ctx.db.prepare(`SELECT 1 FROM ${e.table} WHERE id = ?`).bind(row.id).first())) {
            out.skipped++;
            continue;
          }
          if (a) await a.create(ctx, row, { raw: true });
          else await create(ctx, e, row, { raw: true });
          out.created++;
        } catch (err) {
          out.errors.push({ id: row.id ?? null, error: (err as Error).message });
        }
      }
      ctx.changes.length = 0;
      return c.json(out);
    });
    api.put('/import/settings', async (c) => {
      const ctx = c.get('ctx');
      const { values } = await c.req.json<{ values: Record<string, string> }>();
      for (const [k, v] of Object.entries(values ?? {})) if (/^(rotation|week|nudge|pomodoro)\./.test(k)) await ctx.setSetting(k, v || null);
      return c.json({ ok: true });
    });
    api.get('/features', async (c) => {
      const states = await featureStates(c.get('ctx'));
      return c.json(allFeatures().map((f) => ({ ...f, enabled: states[f.id] })));
    });
    api.put('/features/:id', async (c) => {
      const { enabled, scope } = await c.req.json<{ enabled: boolean; scope?: string }>();
      if (typeof enabled !== 'boolean') throw bad('enabled must be true or false');
      await setFeature(c.get('ctx'), c.req.param('id'), enabled, parseScope(scope ?? c.req.query('scope')));
      const states = await featureStates(c.get('ctx'));
      return c.json(allFeatures().map((f) => ({ ...f, enabled: states[f.id] })));
    });
    api.get('/schema', (c) =>
      c.json(
        allEntities().map((e) => ({ name: e.name, singular: e.singular, desc: e.desc, mode_scoped: e.modeScoped, ordered: !!e.orderGroup, internal: !!e.internal, fields: e.fields })),
      ),
    );
  },
  tools: [
    {
      name: 'describe_kinds',
      description: 'The kinds of rows this tracker stores, their fields and what they mean. Read this before using the generic *_item tools.',
      readOnly: true,
      input: z.object({}),
      run: async (ctx) =>
        [...(await Promise.all(kinds().map(async (e) => (e.feature && !(await ctx.feature(e.feature)) ? null : e)))).filter((e) => !!e), ...allAliases().map((a) => ({ name: a.name, desc: a.desc, orderGroup: ['list_id', 'group_id'], fields: a.fields }))].map((e) => ({
          kind: e.name,
          what: e.desc,
          ordered: !!e.orderGroup,
          fields: Object.fromEntries(
            Object.entries(e.fields)
              .filter(([, f]) => !f.readonly)
              .map(([k, f]) => [k, [f.type, f.required ? 'required' : '', f.enum ? `one of ${f.enum.join('|')}` : '', f.ref ? `id of ${f.ref}` : '', f.desc ?? ''].filter(Boolean).join(', ')]),
          ),
        })),
    },
    {
      name: 'list_items',
      description: 'List rows of any kind (see describe_kinds), with optional exact-match filters such as {"project_id": "..."}.',
      readOnly: true,
      input: z.object({
        kind: z.string(),
        filters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
        limit: z.number().int().max(500).optional(),
        offset: z.number().int().optional(),
      }),
      run: (ctx, a) => kindOps(a.kind).list(ctx, { where: a.filters, limit: a.limit ?? 100, offset: a.offset }),
    },
    {
      name: 'get_item',
      description: 'Get one row of any kind by id.',
      readOnly: true,
      input: z.object({ kind: z.string(), id: z.string() }),
      run: (ctx, a) => kindOps(a.kind).get(ctx, a.id),
    },
    {
      name: 'create_item',
      description: 'Create a row of any kind (see describe_kinds for fields). Prefer the specific tools (create_project, add_card, add_todo ...) when one fits.',
      input: z.object({ kind: z.string(), fields: z.record(z.string(), z.unknown()) }),
      run: (ctx, a) => kindOps(a.kind).create(ctx, a.fields),
    },
    {
      name: 'update_item',
      description: 'Change fields of a row of any kind. Only the fields given change.',
      input: z.object({ kind: z.string(), id: z.string(), fields: z.record(z.string(), z.unknown()) }),
      run: (ctx, a) => kindOps(a.kind).update(ctx, a.id, a.fields),
    },
    {
      name: 'delete_item',
      description: 'Delete a row of any kind, with what belongs to it (a project’s cards, a list’s items ...). Can be undone with undo.',
      input: z.object({ kind: z.string(), id: z.string() }),
      run: async (ctx, a) => {
        await kindOps(a.kind).remove(ctx, a.id);
        return { deleted: a.id };
      },
    },
    {
      name: 'move_item',
      description: 'Reorder a row of an ordered kind: before_id, after_id or index; group fields (such as column_id or group_id) move it to another group.',
      input: z.object({
        kind: z.string(),
        id: z.string(),
        before_id: z.string().optional(),
        after_id: z.string().optional(),
        index: z.number().int().optional(),
        group: z.record(z.string(), z.string().nullable()).optional(),
      }),
      run: (ctx, { kind, id, group, ...t }) => kindOps(kind).move(ctx, id, { ...group, ...t }),
    },
    {
      name: 'undo',
      description: 'Undo the most recent change in this mode (one tool call or one action in the app counts as one change).',
      input: z.object({}),
      run: async (ctx) => (await undoLast(ctx)) ?? { label: null, changes: 0 },
    },
    {
      name: 'redo',
      description: 'Redo the change that was just undone in this mode. Does nothing if something changed after the undo.',
      input: z.object({}),
      run: async (ctx) => (await redoLast(ctx)) ?? { label: null, changes: 0 },
    },
    {
      name: 'get_settings',
      description: 'Settings of the mode and of the whole tracker (time zone, rotation, pomodoro lengths, nudge ...).',
      readOnly: true,
      input: z.object({}),
      run: (ctx) => allSettings(ctx),
    },
  ],
};

export { kindNames };
