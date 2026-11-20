// Where "+ Add panel" puts things (DECISIONS D33), for the sheet a feature registers
// (registerPanelAdder; features/add-panel draws it). A pill of Today: the panel or file goes in
// that pill (a file also goes on Today). Today's All pill and Today without pills: a removed panel
// comes back, a file goes on Today. Project pages: a removed panel comes back, a file goes in the
// project's folder. Each is one request (POST /api/layout/<page>/add), so one Undo takes it back.
// Also Remove for a note, list or whiteboard: off Today and out of every pill.

import { get, post, say, undo, version } from '../../core/api';
import type { FileItem, PanelAdderTarget, PanelDef } from '../../core/registry';
import { isEink } from '../../core/theme';
import { layoutNow, PINNED, saveLayout, titleOf, type Pill } from './store';

/** Panels a feature registers (not notes, lists and whiteboards, which Add file offers). */
export const featurePanels = (all: PanelDef<any>[]) => all.filter((p) => !p.fixed && !p.attachTo && !p.kind && !p.onRemove && !p.alwaysShown && p.id !== PINNED);
const holds = (ids: string[], p: PanelDef<any>) => ids.includes(p.id) || !!p.replaces?.some((r) => ids.includes(r));

const calm = () => isEink() || matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Put a panel's top a little under the sticky header and pills. */
const scrollTo = (el: HTMLElement, smooth: boolean) => window.scrollTo({ top: Math.max(0, scrollY + el.getBoundingClientRect().top - 140), behavior: smooth ? 'smooth' : 'auto' });

/** Scroll a newly added panel into view once it is drawn, and mark it for a moment. */
export function reveal(id: string) {
  const until = Date.now() + 5000;
  const find = () => {
    const el = document.querySelector<HTMLElement>(`[data-panel="${CSS.escape(id)}"]`);
    // The phone's rows draw no box of their own (display: contents): use the panel inside.
    return el && !el.getClientRects().length ? ((el.firstElementChild as HTMLElement | null) ?? el) : el;
  };
  const shown = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    // Its top in view, below the sticky header and pills, and enough of it to see.
    return r.top >= 100 && (r.bottom <= innerHeight - 60 || r.top < innerHeight * 0.4);
  };
  let marked = false;
  const tick = () => {
    const el = find();
    // Wait for the panel, and for the dialog to be gone (closing it gives the focus back, which may scroll).
    if (!el || document.querySelector('dialog[open]')) return void (Date.now() < until && setTimeout(tick, 120));
    if (!shown(el)) scrollTo(el, !calm());
    if (!marked) {
      marked = true;
      const row = el.closest<HTMLElement>('[data-panel]') ?? el;
      row.classList.add('lg-new');
      setTimeout(() => row.classList.remove('lg-new'), 1800);
    }
    // Its content may still be loading, or the page may still be moving: look once more.
    if (Date.now() < until)
      setTimeout(() => {
        const again = find();
        if (again && !shown(again)) scrollTo(again, false);
      }, 700);
  };
  setTimeout(tick, 150);
}

const done = (msg: string) => say(msg, 'info', { label: 'Undo', run: undo });

/** Add panel inside one of Today's pills. `pills` is the list on screen; `saved` whether it is saved. */
export function pillTarget(place: string, pill: Pill, all: PanelDef<any>[], pills: () => Pill[], saved: boolean): PanelAdderTarget {
  const put = async (panel: string, body: Record<string, unknown>, msg: string) => {
    const list = pills();
    const next = list.map((x) => (x.id === pill.id && !x.panels.includes(panel) ? { ...x, panels: [...x.panels, panel] } : x));
    const ok = await saveLayout(place, { pills: next }, () =>
      post(`/layout/${place}/add`, {
        ...body,
        pill: pill.id,
        pills: saved ? undefined : list,
      }),
    );
    if (!ok) return;
    version.value++;
    done(msg);
    reveal(panel);
  };
  return {
    where: `the pill “${pill.name}”`,
    panels: featurePanels(all).filter((p) => !holds(pill.panels, p)),
    addPanel: (p) => put(p.id, { panel: p.id }, `${titleOf(p)} is in “${pill.name}”.`),
    files: {
      accepts: (t) => !!t.panel,
      has: (_f, panel) => !!panel && pill.panels.includes(panel),
      add: (f, panel) => (panel ? put(panel, { file: { type: f.type, id: f.id } }, `${f.name} is on Today, in “${pill.name}”.`) : Promise.resolve()),
      hint: `It goes on Today and in “${pill.name}”.`,
    },
  };
}

/** Add panel on a page's own grid: Today (the All pill, or Today without pills) or project pages. */
export function pageTarget(place: string, all: PanelDef<any>[], props: any): PanelAdderTarget {
  const removed = new Set(layoutNow(place).grid?.removed ?? []);
  const addPanel = async (p: PanelDef<any>) => {
    const g = layoutNow(place).grid ?? { items: {}, removed: [] };
    const ok = await saveLayout(place, { grid: { ...g, removed: g.removed.filter((x) => x !== p.id) } }, () => post(`/layout/${place}/add`, { panel: p.id }));
    if (!ok) return;
    done(`${titleOf(p)} is back${place === 'project' ? ' on project pages' : ' on Today'}.`);
    reveal(p.id);
  };
  const panels = featurePanels(all).filter((p) => removed.has(p.id));
  if (place === 'project') {
    const project = props?.project as { id: string; name: string } | undefined;
    return {
      where: 'project pages',
      panels,
      addPanel,
      files: project
        ? {
            accepts: (t) => !t.fixed,
            has: (f) => f.project_id === project.id,
            add: async (f) => {
              // The folder decides the project (D31): moving it into the project's folder files it here.
              try {
                const { folder } = await get<{ folder: { id: string } | null }>(`/files?project=${encodeURIComponent(project.id)}&limit=1`);
                if (!folder) return;
                await post('/files/move', {
                  items: [{ type: f.type, id: f.id }],
                  folder_id: folder.id,
                });
                version.value++;
                done(`${f.name} is in ${project.name}’s folder, so it shows on this page.`);
              } catch (err) {
                say(`Not saved: ${(err as Error).message}`, 'error');
              }
            },
            hint: `It goes in ${project.name}’s folder and shows on this page.`,
          }
        : null,
    };
  }
  return {
    where: 'Today',
    panels,
    addPanel,
    files: {
      accepts: (t) => !!t.panel,
      has: (f, panel) => !!f.show_today || (!!panel && all.some((p) => p.id === panel)),
      add: async (f, panel) => {
        try {
          await post(`/layout/${place}/add`, {
            file: { type: f.type, id: f.id },
          });
        } catch (err) {
          return void say(`Not saved: ${(err as Error).message}`, 'error');
        }
        version.value++;
        done(`${f.name} is on Today.`);
        if (panel) reveal(panel);
      },
      hint: 'It goes on Today.',
    },
  };
}

/** Remove for a note, list or whiteboard (with Add panel on): off Today and out of every pill. */
export async function removeFilePanel(place: string, p: PanelDef<any>) {
  const pills = layoutNow(place).pills;
  const next =
    pills?.map((x) => ({
      ...x,
      panels: x.panels.filter((id) => id !== p.id),
    })) ?? null;
  const ok = await saveLayout(place, next ? { pills: next } : {}, () => post(`/layout/${place}/remove`, { panel: p.id }));
  if (!ok) return;
  version.value++;
  done(`${titleOf(p)} is off Today. Add panel → Add file puts it back.`);
}

/** Whether a panel is a file on Today (a note, list, to-do list, whiteboard, a project's notes). */
export const isFilePanel = (p: PanelDef<any>) => !!p.kind;

/** "+ Add panel", at the end of a page's panels. */
export function AddPanelButton({ onClick }: { onClick: () => void }) {
  return (
    <div class="lg-add-panel">
      <button class="ghost" onClick={onClick}>
        + Add panel
      </button>
    </div>
  );
}
