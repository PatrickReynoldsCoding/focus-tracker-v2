// How pages are laid out in the web app: where panels sit on a desktop (Today, a project's page),
// which are removed, Today's pills (tabs, on every screen) and their switches. Stored per mode in
// settings rows, so every device shows the same:
//   layout.<page>        { items: { <panel id>: { x, y, w, h? } }, removed: [<panel id>] }  (desktop grid; Today's "All" pill)
//   layout.<page>.pills  [{ id, name, icon, panels: [<panel id>] }]                       (pills, undoable)
//   layout.<page>.grids  { <pill id>: { items, removed: [] } }                              (each pill's own desktop grid)
//   layout.<page>.view   { focusCard, pillCounts, pillSwipe, pillLast, pillAll }           (switches)
// The browser draws everything (web/src/features/layout/); the server only checks and keeps it.
// Pop-out windows are kept on each device (localStorage), not here.

import { z } from 'zod';
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
export type View = { focusCard?: (typeof FOCUS_CARD)[number]; pillCounts?: boolean; pillSwipe?: boolean; pillLast?: boolean; pillAll?: boolean };
const VIEW_SWITCHES = ['pillCounts', 'pillSwipe', 'pillLast', 'pillAll'] as const;
/** The pills the app shows while none are saved (drawn by the browser from the panels on Today). */
export const USUAL_PILLS = 'Today (the Today list and this week; with the today-panel flag off: to-dos for today, habits, this week), Notes (the notes, lists, to-do lists and whiteboards on Today) and More (the other panels); empty ones are left out';

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
    } else if ((VIEW_SWITCHES as readonly string[]).includes(k)) {
      if (typeof b[k] !== 'boolean') throw bad(`${k} must be true or false`);
      out[k as (typeof VIEW_SWITCHES)[number]] = b[k] as boolean;
    } else throw bad(`Unknown setting ${k}`);
  }
  return out;
}

export async function readLayout(ctx: Ctx, p: string) {
  const [grid, pills, grids, view] = await Promise.all([
    ctx.jsonSetting<Grid | null>(`layout.${p}`, null),
    ctx.jsonSetting<Pill[] | null>(`layout.${p}.pills`, null),
    ctx.jsonSetting<Record<string, Grid>>(`layout.${p}.grids`, {}),
    ctx.jsonSetting<View>(`layout.${p}.view`, {}),
  ]);
  return { grid, pills, grids, view };
}

function pillId(raw: string): string {
  if (!PILL_ID.test(raw)) throw bad('Unknown pill');
  return raw;
}

/** Save one pill's grid (null = back to its usual layout). Grids of pills that no longer exist are dropped. */
async function savePillGrid(ctx: Ctx, p: string, pill: string, grid: Grid | null, undoable: boolean) {
  const [grids, pills] = await Promise.all([ctx.jsonSetting<Record<string, Grid>>(`layout.${p}.grids`, {}), ctx.jsonSetting<Pill[] | null>(`layout.${p}.pills`, null)]);
  const keep = pills ? new Set(pills.map((x) => x.id)) : null;
  const next: Record<string, Grid> = {};
  for (const [id, g] of Object.entries(grids)) if (id !== pill && (!keep || keep.has(id))) next[id] = g;
  if (grid) next[pill] = grid;
  const value = Object.keys(next).length ? JSON.stringify(next) : null;
  if (undoable) await setSettingWithUndo(ctx, `layout.${p}.grids`, value);
  else await ctx.setSetting(`layout.${p}.grids`, value);
}

async function savePills(ctx: Ctx, p: string, pills: Pill[] | null) {
  await setSettingWithUndo(ctx, `layout.${p}.pills`, pills ? JSON.stringify(pills) : null);
}

/** What Claude needs to make pills: the panel ids Today knows, with names. */
async function pillPanels(ctx: Ctx) {
  const [lists, boards, projects] = await Promise.all([
    ctx.db.prepare('SELECT id, name, kind, show_today FROM lists WHERE mode = ? ORDER BY ord, name').bind(ctx.mode).all<{ id: string; name: string; kind: string; show_today: number }>(),
    ctx.db.prepare('SELECT id, name, show_today FROM whiteboards WHERE mode = ? ORDER BY name').bind(ctx.mode).all<{ id: string; name: string; show_today: number }>(),
    ctx.db.prepare("SELECT p.id, p.name FROM projects p JOIN notes n ON n.project_id = p.id WHERE p.mode = ? AND n.show_today = 1").bind(ctx.mode).all<{ id: string; name: string }>(),
  ]);
  // With the Today list on (flag today-panel) it takes To do today's place; Habits can still be added.
  const listOn = await ctx.feature('today-panel');
  return [
    ...(listOn ? [{ id: 'today-list', name: 'Today (habits, to-dos and cards for today)' }] : [{ id: 'todos', name: 'To do today' }]),
    { id: 'habits', name: 'Habits' },
    { id: 'plan-week', name: 'This week' },
    { id: 'neglected', name: 'Waiting for you' },
    ...lists.results.map((l) => ({ id: `list-${l.id}`, name: l.name, kind: l.kind, on_today: !!l.show_today })),
    ...boards.results.map((b) => ({ id: `wb-${b.id}`, name: b.name, kind: 'whiteboard', on_today: !!b.show_today })),
    ...projects.results.map((p) => ({ id: `pnote-${p.id}`, name: `${p.name} · notes`, kind: 'project notes', on_today: true })),
  ];
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
      label: 'Today pills',
      description:
        'Today shows the focus card, then a row of pills (tabs). Each pill shows the panels you put in it, on the phone and the computer alike; on a wide screen each pill has its own layout. “All” shows every panel on Today. Off: Today is one page.',
      default: true,
    },
    {
      id: 'popout-windows',
      label: 'Pop-out windows',
      description: 'On a wide screen, pop any panel out into a window that stays on screen on every tab, or dock it on the right. Kept on each device. Not on a phone.',
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
      await savePills(ctx, p, pills);
      return c.json(pills);
    });
    api.delete('/layout/:page/pills', async (c) => {
      // Back to the usual pills; undoable.
      const ctx = c.get('ctx');
      await requireFeature(ctx, 'today-pills');
      const p = page(c.req.param('page'));
      ctx.label = 'reset Today’s pills';
      await savePills(ctx, p, null);
      return c.json({ ok: true });
    });
    api.put('/layout/:page/grids/:pill', async (c) => {
      // One pill's own desktop grid (moves are not undoable, as on the page's grid).
      const ctx = c.get('ctx');
      await requireFeature(ctx, 'today-pills');
      await requireFeature(ctx, 'movable-panels');
      const p = page(c.req.param('page'));
      const id = pillId(c.req.param('pill'));
      const grid = { ...cleanGrid(await c.req.json()), removed: [] };
      await savePillGrid(ctx, p, id, grid, false);
      return c.json(grid);
    });
    api.delete('/layout/:page/grids/:pill', async (c) => {
      // "Reset this pill": undoable.
      const ctx = c.get('ctx');
      await requireFeature(ctx, 'today-pills');
      await requireFeature(ctx, 'movable-panels');
      const p = page(c.req.param('page'));
      const id = pillId(c.req.param('pill'));
      ctx.label = 'reset the pill’s layout';
      await savePillGrid(ctx, p, id, null, true);
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
  tools: [
    {
      name: 'get_today_pills',
      description:
        'Today’s pills (named tabs on Today, the same on every device; each shows the panels listed in it, in order), their switches, and the panel ids a pill can hold with their names. ' +
        `pills null means none are saved and the app shows its usual ones: ${USUAL_PILLS}. An “All” pill (every panel on Today) is added at the end unless view.pillAll is false.`,
      readOnly: true,
      feature: 'today-pills',
      input: z.object({}),
      run: async (ctx) => {
        const { pills, view } = await readLayout(ctx, 'today');
        return { pills, view, panels: await pillPanels(ctx), icons: PILL_ICONS, max_pills: MAX_PILLS };
      },
    },
    {
      name: 'set_today_pills',
      description:
        'Replace Today’s pills with this list (the whole list, in order; null = back to the usual pills). Each pill: id (letters, digits, - or _; keep an existing pill’s id), name (1–24 characters), icon (one of get_today_pills’ icons, or null) and panels (panel ids from get_today_pills, top to bottom). ' +
        'Optionally change the switches in view: focusCard (compact, full, hidden), pillCounts, pillSwipe, pillLast, pillAll (show the All pill). The pills change can be undone.',
      feature: 'today-pills',
      input: z.object({
        pills: z.array(z.object({ id: z.string(), name: z.string(), icon: z.string().nullable().optional(), panels: z.array(z.string()) })).nullable(),
        view: z.record(z.string(), z.unknown()).optional(),
      }),
      run: async (ctx, a) => {
        const pills = a.pills ? cleanPills({ pills: a.pills }) : null;
        const change = a.view ? cleanView(a.view) : null;
        await savePills(ctx, 'today', pills);
        if (change) await ctx.setSetting('layout.today.view', JSON.stringify({ ...(await ctx.jsonSetting<View>('layout.today.view', {})), ...change }));
        return readLayout(ctx, 'today').then(({ pills, view }) => ({ pills, view }));
      },
    },
  ],
};
