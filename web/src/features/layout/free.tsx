// Free arranging (DECISIONS D65, flag `free-panels`; mockup docs/mockups/arrange-free.html): one way
// to arrange panels on a phone and on a computer. Panels sit on cells (12 columns on a computer, 4 on
// a phone; rows of ROW px), each with its own place and size. Hold a panel (a finger, or a long mouse
// press) and every panel can be arranged: drag one anywhere (a dashed outline shows where it lands),
// drag a side to size it, ✕ to remove it, ⋯ for its other actions (Pop out). The gap a panel leaves
// stays a gap; a panel it lands on moves straight down, and so on (`settle`), so nothing ever moves up.
// Done, Esc or a tap on an empty spot finishes. The places are saved in the grid's `cells` (computer)
// or `phone` (phone); a panel with no saved place yet goes below the others, as tall as its content.

import type { VNode } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Menu, MenuItem } from '../../core/menu';
import { usePanelAdder, type PanelDef } from '../../core/registry';
import { isEink } from '../../core/theme';
import { AddFeature } from './AddFeature';
import { AddPanelButton } from './adding';
import { places, sortedIds } from './grid';
import type { GridStore } from './scope';
import { COLS, PHONE, titleOf, useMedia, type Cell, type Grid } from './store';

/** Row height and the space between panels, in px. */
export const ROW = 44;
const GAP = 12;
const PHONE_COLS = 4;
const MIN = { cells: { w: 2, h: 2 }, phone: { w: 1, h: 2 } };
/** How long a press waits, and how far it may wander and still be a hold (px). */
const HOLD_MS = 450;
const SLOP = 10;
/** A panel with no saved place: as tall as its content, at most this many rows. */
const MAX_AUTO_ROWS = 16;
const DEFAULT_ROWS = 6;
/** Pressing these never starts arranging. */
const NO_HOLD = 'input, textarea, select, [contenteditable], .ProseMirror, .sortable-chosen, .fr-x, .fr-more';

type Kind = 'cells' | 'phone';
type Places = Record<string, Cell>;

const overlaps = (a: Cell, b: Cell) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Put `id` at `at` and move every panel it lands on straight down, as far as needed, then the
 *  panels those land on, and so on. Nothing moves up: gaps stay gaps. */
export function settle(base: Places, id: string, at: Cell): Places {
  const out: Places = { [id]: at };
  const fixed: Cell[] = [at];
  const rest = Object.entries(base)
    .filter(([k]) => k !== id)
    .sort(([, a], [, b]) => a.y - b.y || a.x - b.x);
  for (const [k, p0] of rest) {
    const p = { ...p0 };
    for (let guard = 0; guard < 500; guard++) {
      const hit = fixed.filter((f) => overlaps(f, p));
      if (!hit.length) break;
      p.y = Math.max(...hit.map((f) => f.y + f.h));
    }
    fixed.push(p);
    out[k] = p;
  }
  return out;
}

/** The first row where `c` fits among `taken` without overlapping (it keeps its column). */
function firstFree(c: Cell, taken: Cell[]): Cell {
  const p = { ...c, y: 0 };
  for (let guard = 0; guard < 2000; guard++) {
    const hit = taken.filter((t) => overlaps(t, p));
    if (!hit.length) return p;
    p.y = Math.min(...hit.map((t) => t.y + t.h));
  }
  return p;
}

/** Every drawn panel's place: the saved ones, then the others below them in the old reading order,
 *  as tall as their content (`rows`), at their old column on a computer and full width on a phone. */
export function placesFor(ids: string[], list: PanelDef<any>[], saved: Grid | null, kind: Kind, rows: (id: string) => number): Places {
  const own = (kind === 'phone' ? saved?.phone : saved?.cells) ?? {};
  const cols = kind === 'phone' ? PHONE_COLS : COLS;
  const out: Places = {};
  for (const id of ids) {
    const c = own[id];
    if (!c) continue;
    const w = Math.min(cols, Math.max(1, c.w));
    out[id] = { x: Math.min(c.x, cols - w), y: c.y, w, h: Math.max(1, c.h) };
  }
  const old = places(list, saved);
  const order = sortedIds(ids, old).filter((id) => !out[id]);
  const bottom = Math.max(0, ...Object.values(out).map((c) => c.y + c.h));
  const taken: Cell[] = [];
  for (const id of order) {
    const h = rows(id);
    let placed: Cell;
    if (kind === 'phone') placed = firstFree({ x: 0, y: 0, w: cols, h }, taken);
    else if (!old[id].auto) placed = firstFree({ x: old[id].x, y: 0, w: old[id].w, h }, taken);
    else {
      // Never placed: the column where it sits highest, as the older grid did.
      placed = firstFree({ x: 0, y: 0, w: old[id].w, h }, taken);
      for (let x = 1; x + old[id].w <= cols; x++) {
        const c = firstFree({ x, y: 0, w: old[id].w, h }, taken);
        if (c.y < placed.y) placed = c;
      }
    }
    taken.push(placed);
    out[id] = { ...placed, y: placed.y + bottom };
  }
  return out;
}

type Act = {
  kind: 'move' | 'size';
  id: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  pointer: number;
  /** Where the press grabbed the panel (move), or where it started (size), in px. */
  gx: number;
  gy: number;
  cx: number;
  cy: number;
  scroll0: number;
  base: Places;
  next: Places;
};

export function FreeBoard({ place, props, panels, all, store }: { place: string; props: any; panels: PanelDef<any>[]; all: PanelDef<any>[]; store: GridStore }) {
  const phone = useMedia(PHONE);
  const kind: Kind = phone ? 'phone' : 'cells';
  const cols = phone ? PHONE_COLS : COLS;
  const Adder = usePanelAdder();
  const [arranging, setArranging] = useState(false);
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; p: PanelDef<any> } | null>(null);
  const [width, setWidth] = useState(0);
  const [act, setAct] = useState<Act | null>(null);
  /** Content heights in rows of panels with no saved place yet. */
  const [rowsOf, setRowsOf] = useState<Record<string, number>>({});
  const box = useRef<HTMLDivElement>(null);

  const top = panels.filter((p) => p.fixed === 'top');
  const bottomFixed = panels.filter((p) => p.fixed === 'bottom');
  const drawn = panels
    .filter((p) => !p.fixed)
    .map((p) => ({ p, node: p.render(props) as VNode | null }))
    .filter((x) => x.node);
  const ids = drawn.map((x) => x.p.id);
  const saved = store.saved;
  const own = (phone ? saved?.phone : saved?.cells) ?? {};
  const base = placesFor(
    ids,
    drawn.map((x) => x.p),
    saved,
    kind,
    (id) => rowsOf[id] ?? DEFAULT_ROWS,
  );
  const shown = act?.next ?? base;
  const colW = width / cols;
  const now = useRef({ base, shown, act, arranging });
  now.current = { base, shown, act, arranging };

  // The board's width decides the columns' width.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Panels with no saved place are as tall as their content (measured once drawn).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !width) return;
    const next: Record<string, number> = {};
    let changed = false;
    for (const id of ids) {
      if (own[id]) continue;
      const body = el.querySelector<HTMLElement>(`:scope > .fr-item[data-panel="${CSS.escape(id)}"] > .fr-body`);
      if (!body) continue;
      const content = Array.from(body.children).reduce((h, c) => h + (c as HTMLElement).scrollHeight, 0);
      const rows = Math.max(2, Math.min(MAX_AUTO_ROWS, Math.ceil((content + GAP) / ROW)));
      next[id] = rows;
      if (rowsOf[id] !== rows) changed = true;
    }
    if (changed) setRowsOf((r) => ({ ...r, ...next }));
  });

  const finish = () => {
    setArranging(false);
    setMenu(null);
  };
  // Esc finishes; so does a tap on an empty spot (handled on the board).
  useEffect(() => {
    if (!arranging) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('dialog[open]') && finish();
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [arranging]);

  /** Save every drawn panel's place (a panel placed for the first time keeps where it showed). */
  const save = (next: Places) => {
    const g: Grid = { ...(store.read() ?? { items: {}, removed: [] }) };
    g[kind] = { ...((kind === 'phone' ? g.phone : g.cells) ?? {}), ...next };
    store.save(g);
  };

  // ---------- the press: hold to arrange, then move ----------
  const press = useRef<{ id: string; x: number; y: number; pointer: number; timer: number; ready: boolean; el: HTMLElement } | null>(null);

  const swallowClick = () => {
    const stop = (e: Event) => (e.preventDefault(), e.stopPropagation());
    addEventListener('click', stop, { capture: true, once: true });
    addEventListener('contextmenu', stop, { capture: true, once: true });
    setTimeout(() => {
      removeEventListener('click', stop, { capture: true });
      removeEventListener('contextmenu', stop, { capture: true });
    }, 600);
  };

  const onPointerDown = (e: PointerEvent, id: string) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const t = e.target as HTMLElement;
    const el = e.currentTarget as HTMLElement;
    const side = t.closest<HTMLElement>('.fr-grab')?.dataset.side as Act['side'] | undefined;
    if (arranging && side) return startSize(e, id, side);
    if (t.closest('.fr-x, .fr-more')) return;
    if (!arranging && t.closest(NO_HOLD)) return;
    const p = { id, x: e.clientX, y: e.clientY, pointer: e.pointerId, timer: 0, ready: arranging, el };
    press.current = p;
    if (arranging) return;
    el.classList.add('fr-pressing');
    p.timer = window.setTimeout(() => {
      el.classList.remove('fr-pressing');
      // A list item picked up by its own drag keeps the press.
      if (press.current !== p || el.querySelector('.sortable-chosen')) return;
      (document.activeElement as HTMLElement | null)?.blur?.();
      window.getSelection()?.removeAllRanges();
      navigator.vibrate?.(12);
      p.ready = true;
      setArranging(true);
      swallowClick();
    }, HOLD_MS);
  };

  const cancelPress = () => {
    const p = press.current;
    if (!p) return;
    clearTimeout(p.timer);
    p.el.classList.remove('fr-pressing');
    press.current = null;
  };

  const startMove = (e: PointerEvent) => {
    const p = press.current!;
    const r = p.el.getBoundingClientRect();
    press.current = null;
    try {
      p.el.setPointerCapture(p.pointer);
    } catch {
      /* the pointer is gone */
    }
    const b = now.current.base;
    setAct({ kind: 'move', id: p.id, pointer: p.pointer, gx: p.x - r.left, gy: p.y - r.top, cx: e.clientX, cy: e.clientY, scroll0: scrollY, base: b, next: b });
  };

  const startSize = (e: PointerEvent, id: string, side: NonNullable<Act['side']>) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is gone */
    }
    const b = now.current.base;
    setAct({ kind: 'size', id, side, pointer: e.pointerId, gx: e.clientX, gy: e.clientY, cx: e.clientX, cy: e.clientY, scroll0: scrollY, base: b, next: b });
  };

  /** Where the panel being moved or sized goes now, the others settled around it. */
  const targetOf = (a: Act): Cell => {
    const me = a.base[a.id];
    const b = box.current!.getBoundingClientRect();
    const min = MIN[kind];
    if (a.kind === 'move') {
      const x = Math.round((a.cx - b.left - a.gx) / colW);
      const y = Math.round((a.cy - b.top - a.gy) / ROW);
      // At most one row below the lowest other panel, so holding at the bottom edge cannot grow the page for ever.
      const last = Math.max(0, ...Object.entries(a.base).filter(([k]) => k !== a.id).map(([, c]) => c.y + c.h));
      return { ...me, x: Math.max(0, Math.min(cols - me.w, x)), y: Math.max(0, Math.min(last + 1, y)) };
    }
    const dx = Math.round((a.cx - a.gx) / colW);
    const dy = Math.round((a.cy + scrollY - (a.gy + a.scroll0)) / ROW);
    const t = { ...me };
    if (a.side === 'right') t.w = Math.max(min.w, Math.min(cols - me.x, me.w + dx));
    if (a.side === 'left') {
      const x = Math.max(0, Math.min(me.x + me.w - min.w, me.x + dx));
      t.w = me.w + (me.x - x);
      t.x = x;
    }
    if (a.side === 'bottom') t.h = Math.max(min.h, me.h + dy);
    if (a.side === 'top') {
      const y = Math.max(0, Math.min(me.y + me.h - min.h, me.y + dy));
      t.h = me.h + (me.y - y);
      t.y = y;
    }
    return t;
  };

  // Follow the pointer while moving or sizing; the page scrolls near the top and bottom edges.
  useEffect(() => {
    if (!act) return;
    let raf = 0;
    const update = (cx: number, cy: number) =>
      setAct((a) => {
        if (!a) return a;
        const moved = { ...a, cx, cy };
        return { ...moved, next: settle(a.base, a.id, targetOf(moved)) };
      });
    const move = (e: PointerEvent) => e.pointerId === act.pointer && update(e.clientX, e.clientY);
    const up = (e: PointerEvent) => {
      if (e.pointerId !== act.pointer) return;
      const a = now.current.act;
      if (a) save(a.next);
      setAct(null);
    };
    const block = (e: TouchEvent) => e.preventDefault();
    const tick = () => {
      const a = now.current.act;
      if (!a) return;
      const edge = 70;
      const v = a.cy < edge ? -(edge - a.cy) / 4 : a.cy > innerHeight - edge ? (a.cy - (innerHeight - edge)) / 4 : 0;
      if (v) {
        scrollBy(0, v);
        update(a.cx, a.cy);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    document.addEventListener('touchmove', block, { passive: false });
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      document.removeEventListener('touchmove', block);
    };
  }, [act?.id, act?.kind, act?.pointer]);

  // Before anything moves: a press that wanders is a scroll (or nothing); once arranging, it moves.
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = press.current;
      if (!p || e.pointerId !== p.pointer) return;
      const far = Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP;
      if (!far) return;
      if (p.ready) startMove(e);
      else cancelPress();
    };
    const up = (e: PointerEvent) => press.current && e.pointerId === press.current.pointer && cancelPress();
    // While a hold is waiting or ready, the finger does not scroll the page.
    const block = (e: TouchEvent) => press.current?.ready && e.preventDefault();
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    document.addEventListener('touchmove', block, { passive: false });
    return () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      document.removeEventListener('touchmove', block);
    };
  });

  /** Arrow keys while arranging: move by a cell; with Shift, size. */
  const keys = (e: KeyboardEvent, id: string) => {
    if (!arranging) return;
    const me = base[id];
    const min = MIN[kind];
    const t = { ...me };
    const k = e.key;
    if (e.shiftKey) {
      if (k === 'ArrowRight') t.w = Math.min(cols - me.x, me.w + 1);
      else if (k === 'ArrowLeft') t.w = Math.max(min.w, me.w - 1);
      else if (k === 'ArrowDown') t.h = me.h + 1;
      else if (k === 'ArrowUp') t.h = Math.max(min.h, me.h - 1);
      else return;
    } else if (k === 'ArrowRight') t.x = Math.min(cols - me.w, me.x + 1);
    else if (k === 'ArrowLeft') t.x = Math.max(0, me.x - 1);
    else if (k === 'ArrowDown') t.y = me.y + 1;
    else if (k === 'ArrowUp') t.y = Math.max(0, me.y - 1);
    else return;
    e.preventDefault();
    save(settle(base, id, t));
  };

  const remove = (p: PanelDef<any>) => {
    setMenu(null);
    store.remove(p);
  };
  const addPanels = () => (Adder && store.target ? setAdding(true) : store.add());

  const px = (c: Cell) => ({ left: c.x * colW + GAP / 2, top: c.y * ROW + GAP / 2, width: c.w * colW - GAP, height: c.h * ROW - GAP });
  // Room to drop below the last panel while arranging (the panel being moved does not count, so the
  // page does not grow under the finger).
  const settled = act?.kind === 'move' ? Object.entries(act.next).filter(([k]) => k !== act.id).map(([, c]) => c) : Object.values(shown);
  const rows = Math.max(0, ...settled.map((c) => c.y + c.h), act?.kind === 'move' ? act.next[act.id].y + act.next[act.id].h : 0) + (arranging ? 4 : 0);
  const ghost = act ? px(act.next[act.id]) : null;
  const calm = isEink();

  return (
    <div class="lg-page">
      {top.map((p) => (
        <Slot key={p.id} node={p.render(props)} />
      ))}
      {!drawn.length && (
        <div class="card lg-none">
          <p class="muted">No panels here.</p>
          <div class="row">
            <button class="primary small" onClick={addPanels}>
              {store.addLabel}
            </button>
            <button class="ghost small" onClick={store.reset}>
              {store.resetLabel}
            </button>
          </div>
        </div>
      )}
      <div
        ref={box}
        class={`fr-board ${arranging ? 'fr-arranging' : ''} ${act ? 'fr-acting' : ''} ${calm ? 'fr-calm' : ''}`}
        data-place={place}
        data-kind={kind}
        style={{ height: `${rows * ROW}px`, '--fr-col': `${colW}px`, '--fr-row': `${ROW}px` }}
        onPointerDown={(e) => arranging && e.target === e.currentTarget && finish()}
      >
        {ghost && <div class="fr-ghost" style={{ left: `${ghost.left}px`, top: `${ghost.top}px`, width: `${ghost.width}px`, height: `${ghost.height}px` }} aria-hidden="true" />}
        {width > 0 &&
          drawn.map(({ p, node }) => {
            const c = shown[p.id];
            if (!c) return null;
            const r = px(c);
            const moving = act?.kind === 'move' && act.id === p.id;
            const b = box.current?.getBoundingClientRect();
            const style = moving && b ? { left: `${act.cx - b.left - act.gx}px`, top: `${act.cy - b.top - act.gy}px`, width: `${r.width}px`, height: `${r.height}px` } : { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` };
            return (
              <div
                key={p.id}
                class={`fr-item ${moving ? 'fr-moving' : ''} ${act?.kind === 'size' && act.id === p.id ? 'fr-sizing' : ''} ${own[p.id] ? '' : 'fr-auto'}`}
                data-panel={p.id}
                style={style}
                tabIndex={arranging ? 0 : undefined}
                aria-label={arranging ? `${titleOf(p)}: arrow keys move it, Shift + arrow keys size it` : undefined}
                onPointerDown={(e) => onPointerDown(e as unknown as PointerEvent, p.id)}
                onKeyDown={(e) => keys(e as unknown as KeyboardEvent, p.id)}
              >
                <div class="fr-body">{node}</div>
                {arranging && (
                  <>
                    {(['top', 'right', 'bottom', 'left'] as const).map((s) => (
                      <span key={s} class={`fr-grab fr-${s}`} data-side={s} aria-hidden="true" />
                    ))}
                    {!p.alwaysShown && (
                      <button class="fr-x" aria-label={`${store.removeLabel}: ${titleOf(p)}`} title={store.removeLabel} onClick={() => remove(p)}>
                        ✕
                      </button>
                    )}
                    {(p.menu?.(props) ?? []).length > 0 && (
                      <button class="fr-more" aria-label={`More for ${titleOf(p)}`} aria-haspopup="menu" onClick={(e) => setMenu({ anchor: e.currentTarget as HTMLElement, p })}>
                        ⋯
                      </button>
                    )}
                    {act?.kind === 'size' && act.id === p.id && (
                      <span class="fr-tip">
                        {c.w} × {c.h}
                      </span>
                    )}
                  </>
                )}
              </div>
            );
          })}
      </div>
      {Adder && store.target && drawn.length > 0 && !arranging && <AddPanelButton onClick={addPanels} />}
      {bottomFixed.map((p) => (
        <Slot key={p.id} node={p.render(props)} />
      ))}
      {arranging && (
        <div class="fr-bar" role="toolbar" aria-label="Arranging panels">
          <span class="fr-bar-text muted small">Drag a panel anywhere; drag a side to size it.</span>
          <button class="ghost small" onClick={addPanels}>
            + {store.addLabel.replace(/…$/, '')}
          </button>
          <button class="ghost small" onClick={store.reset}>
            ↺ Reset
          </button>
          <button class="primary small fr-done" onClick={finish}>
            Done
          </button>
        </div>
      )}
      {menu && (
        <Menu anchor={menu.anchor} label={titleOf(menu.p)} onClose={() => setMenu(null)}>
          {(menu.p.menu?.(props) ?? []).map((a) => (
            <MenuItem
              key={a.label}
              icon={a.icon}
              onClick={() => {
                setMenu(null);
                a.run();
              }}
            >
              {a.label}
            </MenuItem>
          ))}
          {!menu.p.alwaysShown && (
            <MenuItem icon="✕" danger onClick={() => remove(menu.p)}>
              {store.removeLabel}
            </MenuItem>
          )}
        </Menu>
      )}
      {adding && (Adder && store.target ? <Adder.component place={place} {...store.target} onClose={() => setAdding(false)} /> : <AddFeature place={place} all={all} onClose={() => setAdding(false)} />)}
    </div>
  );
}

function Slot({ node }: { node: VNode | null }) {
  return node;
}
