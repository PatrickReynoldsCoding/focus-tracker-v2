// How pages are laid out in the web app: where panels sit on a desktop (Today, a project's page)
// and which are removed. Stored per mode in settings rows, so every device shows the same:
//   layout.<page>        { items: { <panel id>: { x, y, w, h? } }, removed: [<panel id>] }  (desktop grid)
// The browser draws everything (web/src/features/layout/); the server only checks and keeps it.

import { requireFeature } from '../core/features';
import type { Ctx } from '../core/ctx';
import { bad } from '../core/errors';
import type { Module } from '../core/registry';
import { setSettingWithUndo } from '../core/store';

export const COLUMNS = 12;

const PAGE = /^[a-z][a-z0-9-]{0,30}$/;
const PANEL_ID = /^[A-Za-z0-9_:.-]{1,60}$/;
const MAX_ITEMS = 200;

export type GridItem = { x: number; y: number; w: number; h?: number | null };
export type Grid = { items: Record<string, GridItem>; removed: string[] };

function page(raw: string): string {
  if (!PAGE.test(raw)) throw bad('Unknown page');
  return raw;
}

const int = (v: unknown, name: string, min: number, max: number): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw bad(`${name} must be a whole number from ${min} to ${max}`);
  return v;
};

function panelIds(v: unknown, name: string, max: number): string[] {
  if (!Array.isArray(v)) throw bad(`${name} must be a list of panel ids`);
  if (v.length > max) throw bad(`${name}: at most ${max} panels`);
  const out: string[] = [];
  for (const id of v) {
    if (typeof id !== 'string' || !PANEL_ID.test(id)) throw bad(`${name}: "${String(id).slice(0, 40)}" is not a panel id`);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** Check a desktop layout and keep only what is known. */
export function cleanGrid(body: unknown): Grid {
  const b = (body ?? {}) as { items?: unknown; removed?: unknown };
  const items: Record<string, GridItem> = {};
  if (b.items != null) {
    if (typeof b.items !== 'object' || Array.isArray(b.items)) throw bad('items must be an object of panel id → place');
    const entries = Object.entries(b.items as Record<string, unknown>);
    if (entries.length > MAX_ITEMS) throw bad(`At most ${MAX_ITEMS} panels`);
    for (const [id, raw] of entries) {
      if (!PANEL_ID.test(id)) throw bad(`"${id.slice(0, 40)}" is not a panel id`);
      const p = (raw ?? {}) as Record<string, unknown>;
      const w = int(p.w, `${id}.w`, 1, COLUMNS);
      const x = int(p.x, `${id}.x`, 0, COLUMNS - 1);
      if (x + w > COLUMNS) throw bad(`${id} runs past the right edge (x + w is more than ${COLUMNS})`);
      const y = int(p.y, `${id}.y`, 0, 9999);
      const item: GridItem = { x, y, w };
      if (p.h != null) item.h = int(p.h, `${id}.h`, 60, 4000);
      items[id] = item;
    }
  }
  return { items, removed: panelIds(b.removed ?? [], 'removed', MAX_ITEMS) };
}

export async function readLayout(ctx: Ctx, p: string) {
  return { grid: await ctx.jsonSetting<Grid | null>(`layout.${p}`, null) };
}

export const layoutModule: Module = {
  id: 'layout',
  description: 'Where panels sit on each page (desktop grid).',
  features: [
    {
      id: 'movable-panels',
      label: 'Move and resize panels',
      description: 'On a wide screen, drag a panel on Today or a project’s page by its title, and use Edit layout to resize, remove and add panels. Saved for every device. Off: panels stay in their usual order.',
      default: true,
    },
  ],
  routes(api) {
    api.get('/layout/:page', async (c) => c.json(await readLayout(c.get('ctx'), page(c.req.param('page')))));
    api.put('/layout/:page/grid', async (c) => {
      const ctx = c.get('ctx');
      await requireFeature(ctx, 'movable-panels');
      const p = page(c.req.param('page'));
      const grid = cleanGrid(await c.req.json());
      await ctx.setSetting(`layout.${p}`, JSON.stringify(grid));
      return c.json(grid);
    });
    api.delete('/layout/:page/grid', async (c) => {
      // "Reset this page": undoable, so the toast's Undo brings the arrangement back.
      const ctx = c.get('ctx');
      await requireFeature(ctx, 'movable-panels');
      const p = page(c.req.param('page'));
      ctx.label = 'reset the page’s layout';
      await setSettingWithUndo(ctx, `layout.${p}`, null);
      return c.json({ ok: true });
    });
  },
};
