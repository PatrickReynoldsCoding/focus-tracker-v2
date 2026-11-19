// The desktop grid (V1-GAPS 39): panels in 12 columns, dragged by their title (or the ⠿ grip),
// resized in Edit layout, heights following their content. Hand-made rather than a library: the
// panels are Preact components that must not be moved in the DOM behind Preact's back, the
// packing rule is small, and E-ink needs it to jump rather than slide.
//
// Rule: each panel has a column (x), a width (w, 1–12), an order (y) and optionally a fixed
// height (h; the content scrolls). Panels are placed in order, each as high as the panels already
// placed in its columns allow ("gravity"), so there are never holes or overlaps. Positions are
// set on the elements directly (no re-render) whenever a panel's height changes.

import type { VNode } from 'preact';
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { del, say, undo } from '../../core/api';
import type { PanelDef, PanelLayoutProps } from '../../core/registry';
import { signal, useSignal } from '../../core/signal';
import { isEink } from '../../core/theme';
import { AddFeature } from './AddFeature';
import { GridScope, type GridStore } from './scope';
import { COLS, DESKTOP, layoutNow, saveGrid, saveLayout, titleOf, useLayout, useMedia, type Grid as GridData, type Pos } from './store';

const GAP = 14;
const MIN_W = 2;
const MIN_H = 60;
const DRAG_START = 5; // px a pointer must move before a press on a title becomes a drag

/** The place whose grid is on screen (for the Edit layout button in the header), and the one being edited. */
export const gridOn = signal<string | null>(null);
export const editing = signal<string | null>(null);
const onScreen = new Map<string, number>();

type Placed = Pos & { auto?: boolean };

/** Where every drawn panel goes: its saved place, or (new or never saved) the end, in a column chosen when packed. */
export function places(list: PanelDef<any>[], saved: GridData | null): Record<string, Placed> {
  const out: Record<string, Placed> = {};
  let maxY = -1;
  for (const p of list) {
    // A panel that replaces an older one (PanelDef.replaces) takes its place until it has its own.
    const s = saved?.items[p.id] ?? (p.replaces ?? []).map((r) => saved?.items[r]).find(Boolean);
    if (!s) continue;
    const w = Math.min(COLS, Math.max(1, s.w));
    out[p.id] = { x: Math.min(s.x, COLS - w), y: s.y, w, h: s.h ?? null };
    maxY = Math.max(maxY, s.y);
  }
  let k = 0;
  for (const p of list) if (!out[p.id]) out[p.id] = { x: 0, y: maxY + 1 + k++, w: p.wide ? COLS : COLS / 2, h: null, auto: true };
  return out;
}

/** The order panels are packed in: by y, then x, then their usual order. */
function sortedIds(ids: string[], pos: Record<string, Placed>): string[] {
  const idx = new Map(ids.map((id, i) => [id, i]));
  return [...ids].sort((a, b) => pos[a].y - pos[b].y || (pos[a].auto ? 0 : pos[a].x) - (pos[b].auto ? 0 : pos[b].x) || idx.get(a)! - idx.get(b)!);
}

/** Pack in order: each panel as high as its columns allow. A panel without a column takes the lowest one. */
export function pack(order: string[], pos: Record<string, Placed>, height: (id: string) => number) {
  const sky = new Array(COLS).fill(0);
  const out: Record<string, { x: number; top: number }> = {};
  for (const id of order) {
    const p = pos[id];
    const w = p.w;
    let x = p.x;
    if (p.auto) {
      let best = Infinity;
      for (let c = 0; c + w <= COLS; c += w >= COLS / 2 ? COLS - w || 1 : 1) {
        const t = Math.max(...sky.slice(c, c + w));
        if (t < best) (best = t), (x = c);
      }
    }
    const top = Math.max(...sky.slice(x, x + w));
    out[id] = { x, top };
    const h = height(id);
    if (h > 0) for (let c = x; c < x + w; c++) sky[c] = top + h + GAP;
  }
  return { at: out, height: Math.max(0, Math.max(...sky) - GAP) };
}

const leftCss = (x: number) => `calc(${x} * (100% + ${GAP}px) / ${COLS})`;
const widthCss = (w: number) => `calc(${w} * (100% + ${GAP}px) / ${COLS} - ${GAP}px)`;
const calm = () => isEink() || matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Never a drag, even on a title: fields, editors, and dialogs a panel opened. */
const NO_DRAG = 'input, select, textarea, [contenteditable], .ProseMirror, dialog';

type Drag = {
  id: string;
  kind: 'move' | 'resize';
  pointer: number;
  sx: number;
  sy: number;
  started: boolean;
  /** The panel's place and size when the press began. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Where the others were when the drag began (their order does not change under the pointer). */
  tops: Record<string, number>;
  /** What a drop would save. */
  order?: string[];
  x?: number;
  w?: number;
  h?: number | null;
};

/** The panels' ids in the order a narrow screen shows them (the grid's reading order). */
export function readingOrder(ids: string[], saved: GridData | null): string[] {
  const list = ids.map((id) => ({ id, order: 0, render: () => null }));
  return sortedIds(ids, places(list, saved));
}

/** The layout for 'today' and 'project': the grid on a desktop; on a narrower screen the panels in
 *  the desktop's reading order without the removed ones. Inside one of Today's pills the grid is
 *  the pill's own (GridScope). */
export function GridLayout({ place, props, panels, next }: PanelLayoutProps) {
  const desktop = useMedia(DESKTOP);
  const data = useLayout(place);
  const scope = useContext(GridScope);
  const removed = new Set(scope ? [] : (data?.grid?.removed ?? []));
  const shown = panels.filter((p) => p.fixed || p.alwaysShown || !removed.has(p.id));
  const store: GridStore = scope ?? {
    key: place,
    label: place === 'project' ? 'every project page' : 'Today',
    saved: data?.grid ?? null,
    read: () => layoutNow(place).grid,
    save: (g) => saveGrid(place, g),
    remove: (p, base) => removeFromPage(place, p, base),
    add: () => {},
    addLabel: '+ Add feature',
    reset: () => resetPage(place),
    resetLabel: 'Reset this page',
  };
  if (!desktop) {
    const movable = shown.filter((p) => !p.fixed);
    const pos = places(movable, store.saved);
    const order = sortedIds(
      movable.map((p) => p.id),
      pos,
    );
    const byId = new Map(movable.map((p) => [p.id, p]));
    return next([...shown.filter((p) => p.fixed === 'top'), ...order.map((id) => byId.get(id)!), ...shown.filter((p) => p.fixed === 'bottom')]);
  }
  return <Grid key={store.key} place={place} props={props} panels={shown} all={panels} store={store} own={!scope} />;
}

/** Edit layout's Remove on a page's own grid: a note or list leaves Today; another panel is stored in `removed`. */
function removeFromPage(place: string, p: PanelDef<any>, base?: GridData) {
  if (p.onRemove) return p.onRemove();
  const g = base ?? layoutNow(place).grid ?? { items: {}, removed: [] };
  saveGrid(place, { ...g, removed: [...g.removed.filter((x) => x !== p.id), p.id] }).then(
    (ok) =>
      ok &&
      say(`${titleOf(p)} removed. + Add feature brings it back.`, 'info', {
        label: 'Undo',
        run: () => {
          const g2 = layoutNow(place).grid ?? g;
          saveGrid(place, { ...g2, removed: g2.removed.filter((x) => x !== p.id) });
        },
      }),
  );
}

function Grid({ place, props, panels, all, store, own }: { place: string; props: any; panels: PanelDef<any>[]; all: PanelDef<any>[]; store: GridStore; own: boolean }) {
  const saved = store.saved;
  const edit = useSignal(editing) === place;
  const [adding, setAdding] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const top = panels.filter((p) => p.fixed === 'top');
  const bottom = panels.filter((p) => p.fixed === 'bottom');
  const drawn = panels
    .filter((p) => !p.fixed)
    .map((p) => ({ p, node: p.render(props) as VNode | null }))
    .filter((x) => x.node);
  const ids = drawn.map((x) => x.p.id);
  const pos = places(
    drawn.map((x) => x.p),
    saved,
  );
  // Read by the packing code, which runs outside renders.
  const now = useRef({ ids, pos, saved, drag: null as Drag | null });
  now.current.ids = ids;
  now.current.pos = pos;
  now.current.saved = saved;
  const frame = useRef(0);

  const items = () => {
    const out = new Map<string, HTMLElement>();
    box.current?.querySelectorAll<HTMLElement>(':scope > .lg-item').forEach((el) => out.set(el.dataset.panel!, el));
    return out;
  };
  const heightOf = (els: Map<string, HTMLElement>) => (id: string) => (els.get(id)?.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0;

  /** Put every panel in its place (and the drop shadow while dragging). */
  const layout = () => {
    cancelAnimationFrame(frame.current);
    const el = box.current;
    if (!el) return;
    const els = items();
    const { ids: list, pos: p, drag } = now.current;
    const order = drag?.started && drag.order ? drag.order : sortedIds(list, p);
    const posNow = drag?.started ? { ...p, [drag.id]: { ...p[drag.id], x: drag.x ?? p[drag.id].x, w: drag.w ?? p[drag.id].w, auto: false } } : p;
    const hOf = heightOf(els);
    const height = (id: string) => (drag?.started && drag.id === id && drag.kind === 'resize' && drag.h ? drag.h : hOf(id));
    const { at, height: total } = pack(order, posNow, height);
    for (const [id, e] of els) {
      const a = at[id];
      if (!a) continue;
      if (drag?.started && drag.id === id) {
        const shadow = el.querySelector<HTMLElement>(':scope > .lg-shadow');
        if (shadow) {
          shadow.style.left = leftCss(a.x);
          shadow.style.width = widthCss(posNow[id].w);
          shadow.style.top = `${a.top}px`;
          shadow.style.height = `${height(id)}px`;
        }
        if (drag.kind === 'move') continue; // the dragged panel follows the pointer
      }
      // A panel placed for the first time appears in its place; only later moves slide.
      const first = !e.dataset.x;
      if (first) e.style.transition = 'none';
      e.style.left = leftCss(a.x);
      e.style.width = widthCss(posNow[id].w);
      e.style.top = `${a.top}px`;
      e.dataset.x = String(a.x);
      if (first) {
        void e.offsetHeight;
        e.style.transition = '';
      }
    }
    el.style.height = `${total}px`;
  };
  const soon = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(layout);
  };

  // Place everything before the first paint, then follow every change of size.
  useLayoutEffect(layout);
  useEffect(() => {
    const ro = new ResizeObserver(soon);
    const watch = () => {
      ro.disconnect();
      box.current?.querySelectorAll(':scope > .lg-item > .lg-body').forEach((b) => ro.observe(b));
      if (box.current) ro.observe(box.current);
    };
    watch();
    const mo = new MutationObserver(watch);
    if (box.current) mo.observe(box.current, { childList: true });
    // Slide only once the first places are set (and never in E-ink or with reduced motion).
    const t = requestAnimationFrame(() => box.current?.classList.toggle('lg-anim', !calm()));
    return () => (ro.disconnect(), mo.disconnect(), cancelAnimationFrame(t), cancelAnimationFrame(frame.current));
  }, []);

  useEffect(() => {
    // Counted, so a grid drawn again before the old one is gone does not hide the button.
    onScreen.set(place, (onScreen.get(place) ?? 0) + 1);
    gridOn.value = place;
    // Edit layout stays on while the grid is drawn again (a window resized for a moment); a new page ends it (index.tsx).
    return () => {
      const n = (onScreen.get(place) ?? 1) - 1;
      onScreen.set(place, n);
      if (n <= 0 && gridOn.value === place) gridOn.value = null;
    };
  }, [place]);
  useEffect(() => {
    if (!edit) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('dialog[open]') && (editing.value = null);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [edit]);

  /** The grid with every drawn panel in this order (panels not drawn now keep their place). */
  const gridFor = (order: string[], change: Record<string, Partial<Pos>> = {}): GridData => {
    const cur = store.read();
    const els = items();
    const items_: Record<string, Pos> = {};
    order.forEach((id, i) => {
      const p = now.current.pos[id];
      const c = change[id] ?? {};
      // A panel never placed by hand keeps the column it shows in now.
      const it: Pos = { x: c.x ?? (p.auto ? Number(els.get(id)?.dataset.x ?? 0) : p.x), y: i * 10, w: c.w ?? p.w };
      const h = 'h' in c ? c.h : p.h;
      if (h) it.h = h;
      items_[id] = it;
    });
    for (const [id, it] of Object.entries(cur?.items ?? {})) if (!items_[id]) items_[id] = { ...it };
    return { items: items_, removed: cur?.removed ?? [] };
  };
  const save = (order: string[], change: Record<string, Partial<Pos>> = {}) => store.save(gridFor(order, change));

  // The page's grid also keeps the places the other panels have on screen, so Remove moves nothing else.
  const remove = (p: PanelDef<any>) => store.remove(p, own ? gridFor(sortedIds(now.current.ids, now.current.pos)) : undefined);

  // ---------- dragging and resizing ----------

  const begin = (e: PointerEvent, id: string, kind: Drag['kind']) => {
    const el = items().get(id);
    if (!el || !box.current || e.button !== 0) return;
    const b = box.current.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const tops: Record<string, number> = {};
    items().forEach((e2, k) => (tops[k] = parseFloat(e2.style.top) || 0));
    now.current.drag = { id, kind, pointer: e.pointerId, sx: e.clientX, sy: e.clientY, started: false, left: r.left - b.left, top: r.top - b.top, width: r.width, height: (el.firstElementChild as HTMLElement).offsetHeight, tops };
    if (kind === 'resize') e.preventDefault();
  };

  const move = (e: PointerEvent) => {
    const d = now.current.drag;
    const el = d && items().get(d.id);
    if (!d || !el || !box.current || e.pointerId !== d.pointer) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.started) {
      if (Math.hypot(dx, dy) < DRAG_START) return;
      d.started = true;
      el.setPointerCapture?.(e.pointerId);
      el.classList.add(d.kind === 'move' ? 'lg-moving' : 'lg-resizing');
      document.body.classList.add('lg-dragging');
      window.getSelection()?.removeAllRanges();
      box.current.classList.add('lg-busy');
    }
    e.preventDefault();
    const colW = (box.current.clientWidth + GAP) / COLS;
    const p = now.current.pos[d.id];
    if (d.kind === 'move') {
      // Kept inside the grid's width, so the page never scrolls sideways.
      const left = Math.max(0, Math.min(box.current.clientWidth - d.width, d.left + dx));
      const top = Math.max(0, d.top + dy);
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      d.x = Math.max(0, Math.min(COLS - p.w, Math.round(left / colW)));
      const others = now.current.ids.filter((x) => x !== d.id);
      // On a tie (dragged to the very top, which is clamped to 0) the dragged panel goes first.
      const key = (id: string) => (id === d.id ? top - 0.5 : d.tops[id]);
      const xOf = (id: string) => (id === d.id ? d.x! : Number(items().get(id)?.dataset.x ?? 0));
      d.order = [...others, d.id].sort((a, b) => key(a) - key(b) || xOf(a) - xOf(b));
    } else {
      const x = Number(el.dataset.x ?? p.x);
      d.w = Math.max(MIN_W, Math.min(COLS - x, Math.round((d.left + d.width + dx + GAP) / colW) - x));
      d.h = Math.max(MIN_H, Math.round((d.height + dy) / 10) * 10);
      d.x = x;
      d.order = sortedIds(now.current.ids, now.current.pos);
      el.style.width = widthCss(d.w);
      (el.firstElementChild as HTMLElement).style.height = `${d.h}px`;
    }
    layout();
  };

  const end = (e: PointerEvent, cancel = false) => {
    const d = now.current.drag;
    if (!d || e.pointerId !== d.pointer) return;
    now.current.drag = null;
    if (!d.started) return;
    const el = items().get(d.id);
    el?.classList.remove('lg-moving', 'lg-resizing');
    document.body.classList.remove('lg-dragging');
    box.current?.classList.remove('lg-busy');
    // A press that became a drag is not also a click on the title's link.
    const stop = (ev: Event) => (ev.preventDefault(), ev.stopPropagation());
    window.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
    if (cancel || !d.order) {
      if (el) (el.firstElementChild as HTMLElement).style.height = now.current.pos[d.id]?.h ? `${now.current.pos[d.id].h}px` : '';
      layout();
      return;
    }
    const change: Record<string, Partial<Pos>> = { [d.id]: d.kind === 'move' ? { x: d.x } : { x: d.x, w: d.w, h: d.h } };
    // Show the new places at once (the save re-renders with them).
    now.current.pos = { ...now.current.pos, [d.id]: { ...now.current.pos[d.id], ...change[d.id], auto: false } as Placed };
    now.current.ids = d.order;
    const order = d.order;
    save(order, change);
    layout();
  };

  useEffect(() => {
    const mv = (e: PointerEvent) => move(e);
    const up = (e: PointerEvent) => end(e);
    const cancel = (e: PointerEvent) => end(e, true);
    const esc = (e: KeyboardEvent) => {
      const d = now.current.drag;
      if (e.key === 'Escape' && d?.started) end({ pointerId: d.pointer } as PointerEvent, true);
    };
    window.addEventListener('pointermove', mv, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', esc);
    };
  }, []);

  /** A press inside a panel: on its title (or anywhere while editing) it may become a drag. */
  const press = (e: PointerEvent, id: string) => {
    const t = e.target as HTMLElement;
    if (t.closest('.lg-resize')) return begin(e, id, 'resize');
    if (t.closest('.lg-grip')) return begin(e, id, 'move');
    if (e.pointerType === 'touch') return; // a finger scrolls; it moves a panel only by its grip
    if (edit) {
      if (t.closest('.lg-edit-bar button, dialog')) return;
      return begin(e, id, 'move');
    }
    if (t.closest(NO_DRAG)) return;
    // The title: the panel's heading (links and buttons in it too: a press that does not move is still a click).
    const h2 = t.closest('h2');
    if (!h2 && !(t.closest('.card-head') && !t.closest('button, a'))) return;
    begin(e, id, 'move');
  };

  // ---------- the keyboard: the grip's arrows ----------

  const keys = (e: KeyboardEvent, id: string) => {
    const order = sortedIds(now.current.ids, now.current.pos);
    const at = pack(order, now.current.pos, heightOf(items())).at;
    const p = { ...now.current.pos[id], x: at[id].x };
    const i = order.indexOf(id);
    const change: Partial<Pos> = {};
    let o = order;
    if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) change.w = Math.max(MIN_W, Math.min(COLS - p.x, p.w + (e.key === 'ArrowRight' ? 1 : -1)));
    else if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const h = p.h ?? (items().get(id)?.firstElementChild as HTMLElement | null)?.offsetHeight ?? 200;
      change.h = Math.max(MIN_H, h + (e.key === 'ArrowDown' ? 40 : -40));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') change.x = Math.max(0, Math.min(COLS - p.w, p.x + (e.key === 'ArrowRight' ? 1 : -1)));
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const j = i + (e.key === 'ArrowDown' ? 1 : -1);
      if (j < 0 || j >= order.length) return;
      o = [...order];
      [o[i], o[j]] = [o[j], o[i]];
      change.x = p.x;
    } else return;
    e.preventDefault();
    save(o, { [id]: { x: p.x, ...change } });
  };

  const autoHeight = (id: string) => save(sortedIds(now.current.ids, now.current.pos), { [id]: { h: null } });

  const titleOfPanel = (p: PanelDef<any>) => titleOf(p);
  return (
    <div class={`lg-page ${edit ? 'lg-editing' : ''}`}>
      {top.map((p) => (
        <Fixed key={p.id} node={p.render(props)} />
      ))}
      {edit && (
        <div class="lg-bar card" role="region" aria-label="Edit layout">
          <p>
            <strong>Edit layout</strong>
            <span class="muted"> · {store.label}: drag a panel to move it, its corner to resize it.</span>
          </p>
          <div class="row">
            <button class="primary small" onClick={() => (own ? setAdding(true) : store.add())}>
              {store.addLabel}
            </button>
            <button class="ghost small" onClick={store.reset}>
              {store.resetLabel}
            </button>
            <button class="ghost small" onClick={() => (editing.value = null)}>
              Done
            </button>
          </div>
        </div>
      )}
      <div class="lg-grid" ref={box} data-place={place}>
        {drawn.map(({ p, node }) => {
          const h = pos[p.id].h;
          return (
            <div key={p.id} class={`lg-item ${h ? 'lg-fixed-h' : ''}`} data-panel={p.id} onPointerDown={(e) => press(e as unknown as PointerEvent, p.id)}>
              <div class="lg-body" style={h ? { height: `${h}px` } : undefined}>
                {node}
              </div>
              <button
                class="lg-grip"
                aria-label={`Move ${titleOfPanel(p)}`}
                title="Drag to move. Arrow keys move it; Shift + arrow keys change its size."
                onKeyDown={(e) => keys(e, p.id)}
              >
                ⠿
              </button>
              {edit && (
                <div class="lg-edit">
                  <div class="lg-edit-bar">
                    <span class="lg-edit-name">{titleOfPanel(p)}</span>
                    <span class="lg-edit-acts">
                      {h ? (
                        <button class="small" onClick={() => autoHeight(p.id)}>
                          Auto height
                        </button>
                      ) : null}
                      {!p.alwaysShown && (
                        <button class="small danger" onClick={() => remove(p)} aria-label={`Remove ${titleOfPanel(p)}`}>
                          Remove
                        </button>
                      )}
                    </span>
                  </div>
                  <span class="lg-resize" aria-hidden="true" title="Drag to resize" />
                </div>
              )}
            </div>
          );
        })}
        <div class="lg-shadow" aria-hidden="true" />
      </div>
      {bottom.map((p) => (
        <Fixed key={p.id} node={p.render(props)} />
      ))}
      {adding && <AddFeature place={place} all={all} onClose={() => setAdding(false)} />}
    </div>
  );
}

function Fixed({ node }: { node: VNode | null }) {
  return node;
}

/** "Reset this page": back to the usual layout, undoable from the message. */
export async function resetPage(place: string) {
  const ok = await saveLayout(place, { grid: null }, () => del(`/layout/${place}/grid`));
  if (ok) say('This page is back to its usual layout.', 'info', { label: 'Undo', run: undo });
}
