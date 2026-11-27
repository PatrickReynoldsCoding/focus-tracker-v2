// The Desktop page (DECISIONS D64, flag `desktop-page`): #/desktop, drawn bare (no side bar, header
// or phone bar) for a window that stays behind the others on a computer (docs/desktop-widget-spec.md).
// It shows Today's panels and any note, list or whiteboard, but keeps its own list of them and its own
// layout (GET /api/layout/desktop: `panels`, `grid`), so a file on the Desktop is not put on Today.
// Today's grid draws them (features/layout/grid.tsx; the stack in a narrow window), given the
// Desktop's store through GridScope, the way a pill of Today gives its own.

import type { VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { post, say, undo } from '../../core/api';
import { useFlag, useFlags } from '../../core/features';
import { lookupPanel, placeDef, usePanelAdder, usePanels, type PanelAdderTarget, type PanelDef } from '../../core/registry';
import { Loading } from '../../core/ui';
import { reveal } from '../layout/adding';
import { inApp, setControls } from './app';
import { useKeepDesktopFresh } from './fresh';
import { GridLayout, resetPage } from '../layout/grid';
import { GridScope, type GridStore } from '../layout/scope';
import { DESKTOP, layoutNow, saveGrid, saveLayout, titleOf, useLayout, useMedia } from '../layout/store';

export const PLACE = 'desktop';
/** Today's panels are drawn here, with Today's props. */
const FROM = 'today';
/** A stable window title, so the desktop (a GNOME extension) can find the window. */
export const TITLE = 'Focus Tracker Desktop';

/** Today panels that do nothing away from Today: the sticky notes' buttons (the notes float over Today's page). */
const TODAY_ONLY = new Set(['sticky-notes']);

const holds = (ids: string[], p: PanelDef<any>) => ids.includes(p.id) || !!p.replaces?.some((r) => ids.includes(r));

/** The Desktop's panels now (the saved list, else the usual one). */
const idsNow = () => {
  const l = layoutNow(PLACE);
  return l.panels ?? l.usual ?? [];
};

async function addTo(id: string, body: Record<string, unknown>, name: string) {
  const ids = idsNow();
  if (ids.includes(id)) return;
  const ok = await saveLayout(PLACE, { panels: [...ids, id] }, () => post(`/layout/${PLACE}/add`, body));
  if (!ok) return;
  say(`${name} is on the Desktop.`, 'info', { label: 'Undo', run: undo });
  reveal(id);
}

function removeFrom(p: PanelDef<any>) {
  const ids = idsNow();
  saveLayout(PLACE, { panels: ids.filter((x) => x !== p.id && !p.replaces?.includes(x)) }, () => post(`/layout/${PLACE}/remove`, { panel: p.id })).then(
    (ok) => ok && say(`${titleOf(p)} is off the Desktop.`, 'info', { label: 'Undo', run: undo }),
  );
}

export function Desktop() {
  useKeepDesktopFresh();
  const today = placeDef(FROM)!.useProps('');
  const data = useLayout(PLACE);
  const flags = useFlags();
  const movable = useFlag('movable-panels');
  const Adder = usePanelAdder();
  // With a mouse the Desktop is always the grid, so panels resize from their corner as on a computer,
  // even in a narrow window; in a narrow one a panel starts full width.
  const mouse = useMedia('(pointer: fine)');
  const wideScreen = useMedia(DESKTOP);
  const registered = usePanels<any>(FROM);
  const [adding, setAdding] = useState(false);
  const shown = useRef<PanelDef<any>[]>([]);

  // The app's ⚙ menu: Add panel, and Remove panel with the panels' names as they show.
  useEffect(() => {
    if (!inApp) return;
    setControls({
      add: () => setAdding(true),
      panels: () =>
        shown.current.map((p) => ({
          id: p.id,
          title: document.querySelector(`[data-panel="${CSS.escape(p.id)}"] h2`)?.textContent?.trim() || titleOf(p),
        })),
      remove: (id) => {
        const p = shown.current.find((x) => x.id === id);
        if (p) removeFrom(p);
      },
    });
    return () => setControls(null);
  }, []);

  useEffect(() => {
    const before = document.title;
    document.title = TITLE;
    return () => void (document.title = before);
  }, []);

  if (!today.props || !data) return <Loading error={today.error} />;
  const ids = data.panels ?? data.usual ?? [];
  // Every panel once (an old id and the one that replaced it are one), and each one removable here.
  const panels = ids
    .map((id) => lookupPanel(FROM, id, flags))
    .filter((p, i, all): p is PanelDef<any> => !!p && !p.fixed && all.findIndex((q) => q?.id === p.id) === i)
    .map((p) => ({ ...p, alwaysShown: false, wide: p.wide || !wideScreen }));
  shown.current = panels;

  const target: PanelAdderTarget = {
    where: 'the Desktop',
    panels: registered.filter((p) => !p.fixed && !p.attachTo && !p.kind && !p.onRemove && !TODAY_ONLY.has(p.id) && !holds(ids, p)),
    addPanel: (p) => addTo(p.id, { panel: p.id }, titleOf(p)),
    files: {
      accepts: (t) => !!t.panel,
      has: (_f, panel) => !!panel && ids.includes(panel),
      add: (f, panel) => (panel ? addTo(panel, { file: { type: f.type, id: f.id } }, f.name) : Promise.resolve()),
      hint: 'It goes on the Desktop only, not on Today.',
    },
  };
  const store: GridStore = {
    key: PLACE,
    label: 'the Desktop',
    saved: data.grid,
    read: () => layoutNow(PLACE).grid,
    save: (g) => saveGrid(PLACE, g),
    remove: removeFrom,
    removeLabel: 'Remove from the Desktop',
    add: () => setAdding(true),
    addLabel: 'Add panel…',
    target: Adder ? target : undefined,
    reset: () => resetPage(PLACE),
    resetLabel: 'Reset the Desktop’s layout',
    grid: mouse,
  };

  return (
    <div class={`desktop-page${inApp ? ' in-app' : ''}`}>
      {Adder && !inApp && (
        <button class="ghost small desktop-add" title="Put a panel or a file on the Desktop" aria-label="Add a panel to the Desktop" onClick={() => setAdding(true)}>
          +
        </button>
      )}
      {!panels.length ? (
        <div class="card desktop-empty">
          <p class="muted">The Desktop has no panels yet.</p>
          {Adder && (
            <button class="primary" onClick={() => setAdding(true)}>
              + Add panel
            </button>
          )}
        </div>
      ) : movable ? (
        <GridScope.Provider value={store}>
          <GridLayout place={FROM} props={today.props} panels={panels} next={() => <></>} />
        </GridScope.Provider>
      ) : (
        <div class="grid">{panels.map((p) => <Slot key={p.id} node={p.render(today.props)} />)}</div>
      )}
      {adding && Adder && <Adder.component place={PLACE} {...target} onClose={() => setAdding(false)} />}
    </div>
  );
}

function Slot({ node }: { node: VNode | null }) {
  return node;
}
