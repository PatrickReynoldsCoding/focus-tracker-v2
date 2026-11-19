// How pages are laid out in the web app: where panels sit on a desktop (Today, a project's page),
// which are removed, the phone's Today pills and their switches. Stored per mode in settings rows,
// so every device shows the same:
//   layout.<page>        { items: { <panel id>: { x, y, w, h? } }, removed: [<panel id>] }  (desktop grid)
//   layout.<page>.pills  [{ id, name, icon, panels: [<panel id>] }]                       (phone pills, undoable)
//   layout.<page>.view   { focusCard, pillCounts, pillSwipe, pillLast }                     (phone switches)
// The browser draws everything (web/src/features/layout/); the server only checks and keeps it.

import { requireFeature } from '../core/features';
import type { Ctx } from '../core/ctx';
import { bad } from '../core/errors';
import type { Module } from '../core/registry';
import { setSettingWithUndo } from '../core/store';

export const COLUMNS = 12;
export const MAX_PILLS = 12;
export const PILL_NAME_MAX = 24;
export const PILL_PANELS_MAX = 40;
/** The icons a pill may have (or none). */
export const PILL_ICONS = ['🏠', '💼', '🛒', '🧠', '💪', '📚', '🎯', '📅', '✨', '🌙'];
export const FOCUS_CARD = ['compact', 'full', 'hidden'] as const;

const PAGE = /^[a-z][a-z0-9-]{0,30}$/;
const PANEL_ID = /^[A-Za-z0-9_:.-]{1,60}$/;
const PILL_ID = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_ITEMS = 200;

export type GridItem = { x: number; y: number; w: number; h?: number | null };
export type Grid = { items: Record<string, GridItem>; removed: string[] };
export type Pill = { id: string; name: string; icon: string | null; panels: string[] };
export type View = { focusCard?: (typeof FOCUS_CARD)[number]; pillCounts?: boolean; pillSwipe?: boolean; pillLast?: boolean };

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

/** Check the phone's pills: names, icons, ids and panel ids. */
export function cleanPills(body: unknown): Pill[] {
  const list = (body as { pills?: unknown })?.pills;
  if (!Array.isArray(list)) throw bad('pills must be a list');
  if (list.length > MAX_PILLS) throw bad(`At most ${MAX_PILLS} pills`);
  const seen = new Set<string>();
  return list.map((raw, i) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    if (typeof p.id !== 'string' || !PILL_ID.test(p.id)) throw bad(`Pill ${i + 1} has no valid id`);
    if (seen.has(p.id)) throw bad(`Two pills have the id ${p.id}`);
    seen.add(p.id);
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    if (!name) throw bad(`Pill ${i + 1} needs a name`);
    if ([...name].length > PILL_NAME_MAX) throw bad(`A pill's name is at most ${PILL_NAME_MAX} characters`);
    const icon = p.icon == null || p.icon === '' ? null : String(p.icon);
    if (icon && !PILL_ICONS.includes(icon)) throw bad(`Unknown icon. Choose one of ${PILL_ICONS.join(' ')}, or none`);
    return { id: p.id, name, icon, panels: panelIds(p.panels ?? [], `Pill "${name}"`, PILL_PANELS_MAX) };
  });
}

/** Check switches; only the ones given change. */
export function cleanView(body: unknown): View {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: View = {};
  for (const k of Object.keys(b)) {
    if (k === 'focusCard') {
      if (!FOCUS_CARD.includes(b[k] as never)) throw bad(`focusCard must be one of ${FOCUS_CARD.join(', ')}`);
      out.focusCard = b[k] as View['focusCard'];
    } else if (k === 'pillCounts' || k === 'pillSwipe' || k === 'pillLast') {
      if (typeof b[k] !== 'boolean') throw bad(`${k} must be true or false`);
      out[k] = b[k] as boolean;
    } else throw bad(`Unknown setting ${k}`);
  }
  return out;
}

export async function readLayout(ctx: Ctx, p: string) {
  const [grid, pills, view] = await Promise.all([
    ctx.jsonSetting<Grid | null>(`layout.${p}`, null),
    ctx.jsonSetting<Pill[] | null>(`layout.${p}.pills`, null),
    ctx.jsonSetting<View>(`layout.${p}.view`, {}),
  ]);
  return { grid, pills, view };
}

export const layoutModule: Module = {
  id: 'layout',
  description: 'Where panels sit on each page (desktop grid), the phone’s Today pills and their switches.',
  features: [
    {
      id: 'movable-panels',
      label: 'Move and resize panels',
      description: 'On a wide screen, drag a panel on Today or a project’s page by its title, and use Edit layout to resize, remove and add panels. Saved for every device. Off: panels stay in their usual order.',
      default: true,
    },
    {
      id: 'today-pills',
      label: 'Today pills on a phone',
      description: 'On a phone, Today shows the focus card and a row of pills; each pill shows a group of panels you choose in Today settings. Off: Today is one long page.',
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
    api.put('/layout/:page/pills', async (c) => {
      const ctx = c.get('ctx');
      await requireFeature(ctx, 'today-pills');
      const p = page(c.req.param('page'));
      const pills = cleanPills(await c.req.json());
      ctx.label = 'change Today’s pills';
      await setSettingWithUndo(ctx, `layout.${p}.pills`, JSON.stringify(pills));
      return c.json(pills);
    });
    api.delete('/layout/:page/pills', async (c) => {
      // Back to the default (one pill per panel); undoable.
      const ctx = c.get('ctx');
      await requireFeature(ctx, 'today-pills');
      const p = page(c.req.param('page'));
      ctx.label = 'reset Today’s pills';
      await setSettingWithUndo(ctx, `layout.${p}.pills`, null);
      return c.json({ ok: true });
    });
    api.put('/layout/:page/view', async (c) => {
      const ctx = c.get('ctx');
      const p = page(c.req.param('page'));
      const next = { ...(await ctx.jsonSetting<View>(`layout.${p}.view`, {})), ...cleanView(await c.req.json()) };
      await ctx.setSetting(`layout.${p}.view`, JSON.stringify(next));
      return c.json(next);
    });
  },
};
