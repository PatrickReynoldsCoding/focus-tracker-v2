// Add panel (DECISIONS D33): one way to put a panel on Today, in one of Today's pills or on project
// pages, and to take it off again. A panel is either a feature panel (the Today list, Habits, This
// week …: an id the web app registers) or a file (a note, list, to-do list, whiteboard or a
// project's notes). A file on Today is the file's own row marked show_today, through its file
// source's `today` hook (src/core/files.ts), so this module knows no file types itself.
//
// Each call is one request, so putting a file on Today and in a pill is one undo step.
//   POST /api/layout/:page/add     { panel | file: { type, id }, pill?, pills? }
//   POST /api/layout/:page/remove  { panel | file: { type, id }, pill? }
// `pills` is the list the app shows while none are saved (the usual pills, worked out in the
// browser): adding to one of them saves that list first.

import { z } from 'zod';
import type { Ctx } from '../core/ctx';
import { bad } from '../core/errors';
import { requireFeature } from '../core/features';
import type { FileSource } from '../core/files';
import type { Module } from '../core/registry';
import { setSettingWithUndo } from '../core/store';
import { fileSources } from './files';
import { cleanPills, PANEL_ID, PILL_PANELS_MAX, pillId, readLayout, savePills, type Grid, type Pill } from './layout';

export const FLAG = 'add-panel';
const PAGES = ['today', 'project'] as const;
type Page = (typeof PAGES)[number];

type Target = { page: Page; panel?: string; file?: { type: string; id: string }; pill?: string; pills?: unknown };

function pageOf(raw: string): Page {
  if (!(PAGES as readonly string[]).includes(raw)) throw bad('Panels can be added to today or project pages');
  return raw as Page;
}

async function activeTodaySources(ctx: Ctx): Promise<FileSource[]> {
  const out: FileSource[] = [];
  for (const s of fileSources()) if (s.today && (!s.feature || (await ctx.feature(s.feature)))) out.push(s);
  return out;
}

/** The panel id, and the file behind it when it is one ({ source, id }). */
async function resolve(ctx: Ctx, t: Target): Promise<{ panel: string; file: { source: FileSource; id: string } | null }> {
  const sources = await activeTodaySources(ctx);
  if (t.file) {
    const all = fileSources().filter((s) => s.type === t.file!.type);
    if (!all.length) throw bad(`Unknown file type ${t.file.type}`);
    const source = sources.find((s) => s.type === t.file!.type);
    if (!source) throw bad(`A ${all[0].label.toLowerCase()} cannot be a panel`);
    const panel = source.today!.prefix + t.file.id;
    if (!PANEL_ID.test(panel)) throw bad('Not a file id');
    return { panel, file: { source, id: t.file.id } };
  }
  const panel = String(t.panel ?? '');
  if (!PANEL_ID.test(panel)) throw bad('Give a panel id or a file');
  const source = sources.find((s) => panel.startsWith(s.today!.prefix));
  return { panel, file: source ? { source, id: panel.slice(source.today!.prefix.length) } : null };
}

async function saveGridUndoable(ctx: Ctx, page: Page, grid: Grid | null) {
  await setSettingWithUndo(ctx, `layout.${page}`, grid ? JSON.stringify(grid) : null);
}

/** Put a panel on a page (and in a pill). A file goes on Today; a removed panel comes back. */
export async function addPanel(ctx: Ctx, t: Target) {
  const page = pageOf(t.page);
  const { panel, file } = await resolve(ctx, t);
  const layout = await readLayout(ctx, page);
  if (page === 'project') {
    if (file) throw bad('A file goes on a project by moving it into the project’s folder (Files, or move_files).');
    if (t.pill) throw bad('Project pages have no pills');
  }
  if (file && page === 'today') await file.source.today!.set(ctx, file.id, true);
  let pills: Pill[] | null = null;
  if (t.pill) {
    await requireFeature(ctx, 'today-pills');
    const id = pillId(t.pill);
    const base = layout.pills ?? (t.pills != null ? cleanPills({ pills: t.pills }) : null);
    if (!base) {
      // No pills saved: the app works them out, and a note, list or whiteboard on Today is in its usual Notes pill.
      if (!file) throw bad('Today has no saved pills yet (the app shows its usual ones). Save them with set_today_pills first, or leave out pill.');
    } else {
      const pill = base.find((p) => p.id === id);
      if (!pill) throw bad(`No pill with id ${id}`);
      if (!pill.panels.includes(panel)) {
        if (pill.panels.length >= PILL_PANELS_MAX) throw bad(`A pill holds at most ${PILL_PANELS_MAX} panels`);
        pills = base.map((p) => (p.id === id ? { ...p, panels: [...p.panels, panel] } : p));
        await savePills(ctx, page, pills);
      } else if (!layout.pills) await savePills(ctx, page, (pills = base));
    }
  } else if (layout.grid?.removed.includes(panel)) {
    // On the page's own grid (Today's All pill, Today without pills, project pages): bring it back.
    await saveGridUndoable(ctx, page, { ...layout.grid, removed: layout.grid.removed.filter((x) => x !== panel) });
  }
  return { page, panel, pill: t.pill ?? null, file: file ? { type: file.source.type, id: file.id, on_today: page === 'today' } : null };
}

/** Take a panel off. A file leaves Today and every pill; another panel leaves the pill, or the page. */
export async function removePanel(ctx: Ctx, t: Target) {
  const page = pageOf(t.page);
  const { panel, file } = await resolve(ctx, t);
  const layout = await readLayout(ctx, page);
  if (file && page === 'today') {
    await file.source.today!.set(ctx, file.id, false);
    if (layout.pills?.some((p) => p.panels.includes(panel))) await savePills(ctx, page, layout.pills.map((p) => ({ ...p, panels: p.panels.filter((x) => x !== panel) })));
    return { page, panel, file: { type: file.source.type, id: file.id, on_today: false } };
  }
  if (t.pill) {
    await requireFeature(ctx, 'today-pills');
    const id = pillId(t.pill);
    if (!layout.pills) throw bad('Today has no saved pills yet');
    if (!layout.pills.some((p) => p.id === id)) throw bad(`No pill with id ${id}`);
    await savePills(ctx, page, layout.pills.map((p) => (p.id === id ? { ...p, panels: p.panels.filter((x) => x !== panel) } : p)));
    return { page, panel, pill: id };
  }
  const g = layout.grid ?? { items: {}, removed: [] };
  if (!g.removed.includes(panel)) await saveGridUndoable(ctx, page, { ...g, removed: [...g.removed, panel] });
  return { page, panel };
}

const body = z.object({
  panel: z.string().optional(),
  file: z.object({ type: z.string(), id: z.string() }).optional(),
  pill: z.string().nullable().optional(),
  pills: z.array(z.unknown()).nullable().optional(),
});

export const addPanelModule: Module = {
  id: 'add-panel',
  description: 'Add panel: put a panel or a file on Today, in a pill or on project pages, and take it off.',
  features: [
    {
      id: FLAG,
      label: 'Add panel button',
      description:
        '“+ Add panel” on Today (in the pill on screen) and on project pages: the panels that are not there yet, and “Add file”, a picker like the Files tab (search, types, folders, recent files) that puts a note, list or whiteboard on Today and in the pill. Off: “Add panels…” lists every note and list, and “+ Add to Today” is back.',
      default: true,
    },
  ],
  routes(api) {
    api.post('/layout/:page/add', async (c) => {
      const ctx = c.get('ctx');
      await requireFeature(ctx, FLAG);
      const b = body.parse(await c.req.json());
      ctx.label = 'add a panel';
      return c.json(await addPanel(ctx, { page: pageOf(c.req.param('page')), panel: b.panel, file: b.file, pill: b.pill ?? undefined, pills: b.pills ?? undefined }));
    });
    api.post('/layout/:page/remove', async (c) => {
      const ctx = c.get('ctx');
      await requireFeature(ctx, FLAG);
      const b = body.parse(await c.req.json());
      ctx.label = 'remove a panel';
      return c.json(await removePanel(ctx, { page: pageOf(c.req.param('page')), panel: b.panel, file: b.file, pill: b.pill ?? undefined }));
    });
  },
  tools: [
    {
      name: 'add_panel',
      description:
        'Add a panel to Today, to one of Today’s pills (pill: an id from get_today_pills), or back onto project pages. Give a panel id (feature panels such as today-list, habits, plan-week, neglected; see get_today_pills) or a file (file_type and file_id from list_files: a note, list, to-do list, whiteboard or a project’s notes); a file is put on Today. ' +
        'With no pills saved, a file on Today shows in the usual Notes pill, so leave out pill. A file goes on a project by moving it into the project’s folder (move_files) instead. Can be undone.',
      feature: FLAG,
      input: z.object({
        page: z.enum(PAGES).default('today'),
        panel: z.string().optional(),
        file_type: z.string().optional(),
        file_id: z.string().optional(),
        pill: z.string().optional(),
      }),
      run: (ctx, a) => {
        ctx.label = 'add a panel';
        return addPanel(ctx, { page: a.page, panel: a.panel, file: a.file_type && a.file_id ? { type: a.file_type, id: a.file_id } : undefined, pill: a.pill });
      },
    },
    {
      name: 'remove_panel',
      description:
        'Take a panel off Today, out of one of Today’s pills, or off project pages. A file (file_type and file_id, or its panel id such as list-<id>, wb-<id>, pnote-<project id>) leaves Today and every pill. Another panel leaves the pill given, else the page (Add panel brings it back). Can be undone.',
      feature: FLAG,
      input: z.object({
        page: z.enum(PAGES).default('today'),
        panel: z.string().optional(),
        file_type: z.string().optional(),
        file_id: z.string().optional(),
        pill: z.string().optional(),
      }),
      run: (ctx, a) => {
        ctx.label = 'remove a panel';
        return removePanel(ctx, { page: a.page, panel: a.panel, file: a.file_type && a.file_id ? { type: a.file_type, id: a.file_id } : undefined, pill: a.pill });
      },
    },
  ],
};
