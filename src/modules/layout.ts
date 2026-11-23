// How pages are laid out in the web app: where panels sit on a desktop (Today, a project's page),
// which are removed, Today's pills (tabs, on every screen) and their switches. Stored per mode in
// settings rows, so every device shows the same:
//   layout.<page>        { items: { <panel id>: { x, y, w, h?, ph? } }, removed: [<panel id>],   (desktop grid; Today's "All" pill;
//                          cells?: { <panel id>: { x, y, w, h } }, phone?: { … } }          h: fixed height on a computer, ph: on a phone; y also sets the phone's order.
//                        cells / phone: free arranging (flag free-panels, D65): places in cells, 12 columns on a computer and 4
//                        on a phone, y and h in rows; a gap stays a gap)
//   layout.<page>.pills  [{ id, name, icon, panels: [<panel id>] }]                       (pills, undoable)
//   layout.<page>.grids  { <pill id>: { items, removed: [] } }                              (each pill's own desktop grid)
//   layout.<page>.view   { focusCard, pillCounts, pillSwipe, pillLast, pillAll }           (switches)
//   layout.desktop.panels [<panel id>]                                                   (the Desktop page's own panels, src/modules/desktop.ts)
// The browser draws everything (web/src/features/layout/); the server only checks and keeps it.
// Pop-out windows are kept on each device (localStorage), not here. Today's view switches can each be
// set for this profile or for every profile (D46); the grids and pills name the profile's own files, so
// they stay the profile's.

import { z } from 'zod';
import { requireFeature } from '../core/features';
import type { Ctx } from '../core/ctx';
import { bad } from '../core/errors';
import type { Module } from '../core/registry';
import { parseScope, scopedSetting, SCOPES, writeScoped, type Scope, type ScopedSetting } from '../core/setting-scope';
import { setSettingWithUndo } from '../core/store';
import { DESKTOP_PANELS_MAX, DESKTOP_USUAL, FLAG as DESKTOP_FLAG, readDesktopPanels, saveDesktopPanels } from './desktop';

export const COLUMNS = 12;
export const MAX_PILLS = 12;
export const PILL_NAME_MAX = 24;
export const PILL_PANELS_MAX = 40;
/** The icons a pill may have (or none). */
export const PILL_ICONS = ['🏠', '💼', '🛒', '🧠', '💪', '📚', '🎯', '📅', '✨', '🌙'];
export const FOCUS_CARD = ['compact', 'full', 'hidden'] as const;

const PAGE = /^[a-z][a-z0-9-]{0,30}$/;
export const PANEL_ID = /^[A-Za-z0-9_:.-]{1,60}$/;
const PILL_ID = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_ITEMS = 200;

export type GridItem = { x: number; y: number; w: number; h?: number | null; ph?: number | null };
/** A place in cells (free arranging, D65): column, row, width in columns, height in rows. */
export type Cell = { x: number; y: number; w: number; h: number };
export type Grid = { items: Record<string, GridItem>; removed: string[]; cells?: Record<string, Cell>; phone?: Record<string, Cell> };
export const PHONE_COLUMNS = 4;
const MAX_ROW = 2000;
const MAX_ROWS = 200;
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
      if (p.ph != null) item.ph = int(p.ph, `${id}.ph`, 60, 4000);
      items[id] = item;
    }
  }
  const out: Grid = { items, removed: panelIds(b.removed ?? [], 'removed', MAX_ITEMS) };
  const c = body as { cells?: unknown; phone?: unknown } | null;
  if (c?.cells != null) out.cells = cleanCells(c.cells, 'cells', COLUMNS);
  if (c?.phone != null) out.phone = cleanCells(c.phone, 'phone', PHONE_COLUMNS);
  return out;
}

/** Check free places: whole cells inside the columns. Overlaps are the browser's to avoid. */
function cleanCells(v: unknown, name: string, cols: number): Record<string, Cell> {
  if (typeof v !== 'object' || Array.isArray(v)) throw bad(`${name} must be an object of panel id → place`);
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > MAX_ITEMS) throw bad(`At most ${MAX_ITEMS} panels`);
  const out: Record<string, Cell> = {};
  for (const [id, raw] of entries) {
    if (!PANEL_ID.test(id)) throw bad(`"${id.slice(0, 40)}" is not a panel id`);
    const p = (raw ?? {}) as Record<string, unknown>;
    const w = int(p.w, `${name}.${id}.w`, 1, cols);
    const x = int(p.x, `${name}.${id}.x`, 0, cols - 1);
    if (x + w > cols) throw bad(`${name}.${id} runs past the right edge (x + w is more than ${cols})`);
    out[id] = { x, y: int(p.y, `${name}.${id}.y`, 0, MAX_ROW), w, h: int(p.h, `${name}.${id}.h`, 1, MAX_ROWS) };
  }
  return out;
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
  const [grid, pills, grids, view, panels] = await Promise.all([
    ctx.jsonSetting<Grid | null>(`layout.${p}`, null),
    ctx.jsonSetting<Pill[] | null>(`layout.${p}.pills`, null),
    ctx.jsonSetting<Record<string, Grid>>(`layout.${p}.grids`, {}),
    ctx.jsonSetting<View>(`layout.${p}.view`, {}),
    p === 'desktop' ? readDesktopPanels(ctx) : Promise.resolve(null),
  ]);
  // panels: only the Desktop page keeps its own list (null = the usual ones).
  return { grid, pills, grids, view, ...(p === 'desktop' ? { panels, usual: DESKTOP_USUAL } : {}) };
}

export function pillId(raw: string): string {
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

export async function savePills(ctx: Ctx, p: string, pills: Pill[] | null) {
  await setSettingWithUndo(ctx, `layout.${p}.pills`, pills ? JSON.stringify(pills) : null);
}

/** What Claude needs to make pills: the panel ids Today knows, with names. */
export async function pillPanels(ctx: Ctx) {
  const [lists, boards, projects] = await Promise.all([
    ctx.db.prepare('SELECT id, name, kind, show_today FROM lists WHERE mode = ? ORDER BY ord, name').bind(ctx.mode).all<{ id: string; name: string; kind: string; show_today: number }>(),
    ctx.db.prepare('SELECT id, name, show_today FROM whiteboards WHERE mode = ? ORDER BY name').bind(ctx.mode).all<{ id: string; name: string; show_today: number }>(),
    ctx.db.prepare("SELECT p.id, p.name FROM projects p JOIN notes n ON n.project_id = p.id WHERE p.mode = ? AND n.show_today = 1").bind(ctx.mode).all<{ id: string; name: string }>(),
  ]);
  // With the Today list on (flag today-panel) it takes To do today's place; Habits can still be added.
  const listOn = await ctx.feature('today-panel');
  return [
    ...(listOn ? [{ id: 'today-list', name: 'Today (habits, to-dos and cards for today)' }] : [{ id: 'todos', name: 'To do today' }]),
    ...((await ctx.feature('habits')) ? [{ id: 'habits', name: 'Habits' }] : []),
    { id: 'plan-week', name: 'This week' },
    { id: 'neglected', name: 'Waiting for you' },
    ...lists.results.map((l) => ({ id: `list-${l.id}`, name: l.name, kind: l.kind, on_today: !!l.show_today })),
    ...boards.results.map((b) => ({ id: `wb-${b.id}`, name: b.name, kind: 'whiteboard', on_today: !!b.show_today })),
    ...projects.results.map((p) => ({ id: `pnote-${p.id}`, name: `${p.name} · notes`, kind: 'project notes', on_today: true })),
  ];
}

const VIEW_LABELS: Record<keyof View, string> = {
  focusCard: 'Focus card',
  pillCounts: 'Show counts on pills',
  pillSwipe: 'Swipe between pills',
  pillLast: 'Open on the pill I used last',
  pillAll: 'Show the All pill',
};

/** Today's view switches, each settable for this profile or for every profile. */
const viewSettings: ScopedSetting[] = (Object.keys(VIEW_LABELS) as (keyof View)[]).map((k) => ({
  id: `today-view.${k}`,
  key: 'layout.today.view',
  field: k,
  label: VIEW_LABELS[k],
  section: 'today-view',
  parse: (v: unknown) => cleanView({ [k]: v })[k],
}));

/** Change some of a page's view switches; on Today each one goes to this profile or to every profile. */
export async function saveView(ctx: Ctx, p: string, change: View, scope: Scope = 'profile'): Promise<{ view: View; cleared: string[] }> {
  if (p !== 'today') {
    if (scope === 'all') throw bad('Only Today’s view can be set for every profile');
    const next = { ...(await ctx.jsonSetting<View>(`layout.${p}.view`, {})), ...change };
    await ctx.setSetting(`layout.${p}.view`, JSON.stringify(next));
    return { view: next, cleared: [] };
  }
  const cleared = new Set<string>();
  for (const [k, v] of Object.entries(change)) for (const m of (await writeScoped(ctx, scopedSetting(`today-view.${k}`), v, scope)).cleared) cleared.add(m);
  return { view: await ctx.jsonSetting<View>('layout.today.view', {}), cleared: [...cleared] };
}

export const layoutModule: Module = {
  id: 'layout',
  description: 'Where panels sit on each page (desktop grid), the phone’s Today pills and their switches.',
  scopedSettings: viewSettings,
  features: [
    {
      id: 'movable-panels',
      label: 'Move and resize panels',
      description:
        'Move and resize panels on Today and a project’s page, straight on the page: on a computer drag a panel by its title, resize it from its corner and use its ⋯ menu to remove it; on a phone press and hold a panel to move it, change its height or remove it. Saved for every device. Off: panels stay in their usual order.',
      default: true,
    },
    {
      id: 'free-panels',
      label: 'Arrange panels freely',
      description:
        'One way to arrange, on a phone and a computer: hold a panel (a long mouse press on a computer) and every panel can be moved anywhere and sized from any side. A gap stays a gap, and a panel you drop onto another pushes it down. A phone (4 columns) and a computer (12 columns) each keep their own arrangement. Off: the older way (drag by the title on a computer, a long press to arrange a list on a phone). Needs “Move and resize panels”.',
      default: true,
    },
    {
      id: 'today-pills',
      label: 'Today pills',
      description:
        'On a phone, Today shows the focus card, then a row of pills (tabs); each pill shows the panels you put in it. On a computer the pills also show when “Today pills on a computer” is on, each with its own layout; “All” shows every panel on Today. Off: Today is one page everywhere.',
      default: true,
    },
    {
      id: 'desktop-pills',
      label: 'Today pills on a computer',
      description:
        'Off (usual): on a computer, Today shows the focus card and then every panel in one page, the layout you arranged (the same as the All pill), with + Add panel; there is no row of pills. On: the computer shows the row of pills as the phone does, each pill with its own layout, with Edit pill and + New pill. Needs “Today pills”. The phone is not affected: it follows “Today pills”.',
      default: false,
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
      const { scope, ...body } = ((await c.req.json()) ?? {}) as Record<string, unknown>;
      return c.json((await saveView(ctx, p, cleanView(body), parseScope(scope ?? c.req.query('scope')))).view);
    });
  },
  tools: [
    {
      name: 'get_today_pills',
      description:
        'Today’s pills (named tabs on Today, the same on every device; a computer shows them only while the “desktop-pills” switch is on, and shows every panel on one page otherwise; each shows the panels listed in it, in order), their switches, and the panel ids a pill can hold with their names. ' +
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
        'Optionally change the switches in view: focusCard (compact, full, hidden), pillCounts, pillSwipe, pillLast, pillAll (show the All pill); with view_scope "all" those switches change in every profile (the pills stay this profile’s). The pills change can be undone.',
      feature: 'today-pills',
      input: z.object({
        pills: z.array(z.object({ id: z.string(), name: z.string(), icon: z.string().nullable().optional(), panels: z.array(z.string()) })).nullable(),
        view: z.record(z.string(), z.unknown()).optional(),
        view_scope: z.enum(SCOPES).optional().describe('"profile" (the usual) or "all": the view switches for every profile.'),
      }),
      run: async (ctx, a) => {
        const pills = a.pills ? cleanPills({ pills: a.pills }) : null;
        const change = a.view ? cleanView(a.view) : null;
        await savePills(ctx, 'today', pills);
        if (change) await saveView(ctx, 'today', change, parseScope(a.view_scope));
        return readLayout(ctx, 'today').then(({ pills, view }) => ({ pills, view }));
      },
    },
    {
      name: 'get_page_layout',
      description:
        'Where panels sit on Today, on project pages (one layout for every project page) or on the Desktop page (page "desktop", a bare page for a window behind the others on a computer): each panel id with its column x (0–11), width w in columns (1–12), order y, and optional fixed heights h (computer) and ph (phone), in pixels; and removed (panels taken off the page). ' +
        'With pill (a pill id from get_today_pills), the layout inside that pill of Today. grid null means the usual layout. The phone shows panels in y order. ' +
        'The Desktop also gives panels: the panel ids on it, in order (null = the usual ones, listed in usual); the same panel ids as get_today_pills. ' +
        'With free arranging (the usual, switch free-panels) the app places panels by cells and phone instead: panel id → { x, y, w, h } in cells (cells: 12 columns on a computer; phone: 4 columns), y and h in rows of about 44 px; a gap stays a gap. A panel missing from them goes below the others.',
      readOnly: true,
      feature: 'movable-panels',
      input: z.object({ page: z.enum(['today', 'project', 'desktop']), pill: z.string().optional() }),
      run: async (ctx, a) => {
        if (a.page === 'desktop') await requireFeature(ctx, DESKTOP_FLAG);
        const l = await readLayout(ctx, a.page);
        if (a.page === 'desktop') return { page: a.page, grid: l.grid, panels: l.panels, usual: l.usual };
        if (a.pill) return { page: a.page, pill: a.pill, grid: l.grids[pillId(a.pill)] ?? null };
        return { page: a.page, grid: l.grid };
      },
    },
    {
      name: 'set_page_layout',
      description:
        'Replace the layout of Today, of project pages, of the Desktop page or of one of Today’s pills (pill id): the whole grid as get_page_layout returns it (items and removed; null = back to the usual layout). x + w may not pass 12; h and ph are 60–4000 or left out for “follow the content”. With free arranging set cells (computer, x + w at most 12) and phone (x + w at most 4): { x, y, w, h } in cells, h 1–200 rows; panels must not overlap. ' +
        'For the Desktop, panels (optional) replaces its list of panel ids, in order (null = the usual ones); leave out grid to keep it. Can be undone.',
      feature: 'movable-panels',
      input: z.object({
        page: z.enum(['today', 'project', 'desktop']),
        pill: z.string().optional(),
        grid: z
          .object({
            items: z.record(z.string(), z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number().nullable().optional(), ph: z.number().nullable().optional() })),
            removed: z.array(z.string()).optional(),
            cells: z.record(z.string(), z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })).optional(),
            phone: z.record(z.string(), z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })).optional(),
          })
          .nullable()
          .optional(),
        panels: z.array(z.string()).nullable().optional(),
      }),
      run: async (ctx, a) => {
        const grid = a.grid ? cleanGrid(a.grid) : null;
        ctx.label = 'change a page’s layout';
        if (a.page === 'desktop') {
          await requireFeature(ctx, DESKTOP_FLAG);
          if (a.pill) throw bad('The Desktop has no pills');
          if (a.panels !== undefined) await saveDesktopPanels(ctx, a.panels && panelIds(a.panels, 'panels', DESKTOP_PANELS_MAX));
          if (a.grid !== undefined) await setSettingWithUndo(ctx, `layout.${a.page}`, grid ? JSON.stringify(grid) : null);
          const l = await readLayout(ctx, a.page);
          return { page: a.page, grid: l.grid, panels: l.panels };
        }
        if (a.panels !== undefined) throw bad('Only the Desktop has its own list of panels');
        if (a.grid === undefined) throw bad('Give grid (or null for the usual layout)');
        if (a.pill) {
          await requireFeature(ctx, 'today-pills');
          await savePillGrid(ctx, a.page, pillId(a.pill), grid && { ...grid, removed: [] }, true);
          return { page: a.page, pill: a.pill, grid: (await readLayout(ctx, a.page)).grids[a.pill] ?? null };
        }
        await setSettingWithUndo(ctx, `layout.${a.page}`, grid ? JSON.stringify(grid) : null);
        return { page: a.page, grid: (await readLayout(ctx, a.page)).grid };
      },
    },
  ],
};
