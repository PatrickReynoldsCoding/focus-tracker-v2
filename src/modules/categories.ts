// Manage categories (D48): colour and order rules for categories, how many things use each one,
// and deleting one that is in use (its projects, backlog items, habits and resources are left
// with no category, in the same undo step). Claude's category tools live here too.

import { z } from 'zod';
import type { Ctx } from '../core/ctx';
import { bad } from '../core/errors';
import { allEntities, type Module } from '../core/registry';
import { create, get, list, move, remove, update } from '../core/store';
import { categoriesEntity } from './basics';

export const CATEGORY_COLOURS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'grey'];
const USERS = [
  ['projects', 'project'],
  ['backlog', 'backlog item'],
  ['habits', 'habit'],
  ['resources', 'resource'],
] as const;

/** A colour name from the palette, #rrggbb (kept lower case), or none. */
export function cleanCategoryColour(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const s = String(v).trim();
  if (CATEGORY_COLOURS.includes(s)) return s;
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  throw bad(`color must be one of ${CATEGORY_COLOURS.join(', ')} or look like #3366cc`);
}

function cleanLabel(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  const s = String(v).trim();
  if (!s) throw bad('A category needs a name');
  return s.slice(0, 60);
}

/** What uses each category of the profile: { <id>: { projects: n, ... } }. */
export async function categoryUsage(ctx: Ctx, id?: string): Promise<Record<string, Record<string, number>>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [table] of USERS) {
    const rows = (
      await ctx.db
        .prepare(`SELECT category_id AS id, COUNT(*) AS n FROM ${table} WHERE mode = ? AND category_id IS NOT NULL GROUP BY category_id`)
        .bind(ctx.mode)
        .all<{ id: string; n: number }>()
    ).results;
    for (const r of rows) if (!id || r.id === id) (out[r.id] ??= {})[table] = r.n;
  }
  return out;
}

/** Delete a category; what used it is left with none . */
export async function deleteCategory(ctx: Ctx, id: string) {
  const row = await get(ctx, categoriesEntity, id);
  for (const [table] of USERS) {
    const used = (await ctx.db.prepare(`SELECT id FROM ${table} WHERE mode = ? AND category_id = ?`).bind(ctx.mode, id).all<{ id: string }>()).results;
    for (const u of used) {
      const kind = allEntities().find((e) => e.table === table)!;
      await update(ctx, kind, u.id, { category_id: null });
    }
  }
  await remove(ctx, categoriesEntity, id);
  return row;
}

export const categoriesModule: Module = {
  id: 'categories',
  description: 'Manage categories: colour and name rules, usage counts, delete with what uses them, Claude’s category tools.',
  entities: [],
  routes(api) {
    // The web app's Manage categories dialog (before the generic routes).
    api.get('/categories/usage', async (c) => c.json(await categoryUsage(c.get('ctx'))));
    api.post('/categories/:id/delete', async (c) => {
      const ctx = c.get('ctx');
      ctx.label = 'delete category';
      await deleteCategory(ctx, c.req.param('id'));
      return c.json({ deleted: c.req.param('id') });
    });
  },
  async beforeWrite(_ctx, e, row) {
    if (e.name !== 'categories') return;
    const colour = cleanCategoryColour(row.color);
    if (colour !== undefined) row.color = colour;
    const label = cleanLabel(row.label);
    if (label !== undefined) row.label = label;
  },
  tools: [
    {
      name: 'list_categories',
      description: 'List the categories of the mode in their order, with colour and uses (how many projects, backlog items, habits and resources use each).',
      readOnly: true,
      input: z.object({}),
      run: (ctx) => listCategoriesWithUse(ctx),
    },
    {
      name: 'create_category',
      description: 'Make a category for projects. color is a name (red, orange, yellow, green, teal, blue, purple, pink, grey) or #rrggbb; it sets the category button’s colour. It goes last unless index is given.',
      input: z.object({ label: z.string(), color: z.string().nullable().optional(), index: z.number().int().optional() }),
      run: async (ctx, a) => {
        const made = await create(ctx, categoriesEntity, { label: a.label, color: a.color ?? null });
        return a.index === undefined ? made : move(ctx, categoriesEntity, String(made.id), { index: a.index });
      },
    },
    {
      name: 'update_category',
      description: 'Rename a category and/or change its colour (a name from the palette, #rrggbb, or null for none).',
      input: z.object({ id: z.string(), label: z.string().optional(), color: z.string().nullable().optional() }),
      run: (ctx, { id, ...patch }) => update(ctx, categoriesEntity, id, patch),
    },
    {
      name: 'move_category',
      description: 'Put a category in a new place among the categories: before_id, after_id or index (0 = first).',
      input: z.object({ id: z.string(), before_id: z.string().optional(), after_id: z.string().optional(), index: z.number().int().optional() }),
      run: (ctx, { id, ...t }) => move(ctx, categoriesEntity, id, t),
    },
    {
      name: 'delete_category',
      description: 'Delete a category. Its projects, backlog items, habits and resources are kept and left with no category. One undo brings everything back. list_categories gives how many things use each (uses).',
      input: z.object({ id: z.string() }),
      run: async (ctx, a) => ({ deleted: (await deleteCategory(ctx, a.id)).id }),
    },
  ],
};

export async function listCategoriesWithUse(ctx: Ctx) {
  const rows = await list(ctx, categoriesEntity);
  const use = await categoryUsage(ctx);
  return rows.map((r) => ({ ...r, uses: use[String(r.id)] ?? {} }));
}
