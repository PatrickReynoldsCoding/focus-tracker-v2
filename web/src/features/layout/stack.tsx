// The panels on a narrower screen (under 900 px; a phone): one under the other, in the desktop
// grid's reading order. Press and hold a panel (about half a second) to arrange them: every panel
// gets a bar to drag it up or down (the page scrolls near the edges), a handle at its bottom to
// set its height (`ph`, the phone's own; "Auto height" goes back to following the content) and
// Remove. Done, a tap outside the panels, Back or Escape ends it. The order is the grid's order
// (y), so the phone and the computer show the panels in the same order; saved like a desktop move.
//
// A hold starts arranging anywhere on a panel (its title always) except where a hold means
// something else: fields, a note's text and its editor (selecting text), a whiteboard being drawn,
// a project's board, and list items that drag (resources, criteria). Moving the finger (scrolling)
// cancels it.

import type { VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { usePanelAdder, type PanelDef } from '../../core/registry';
import { signal, useSignal } from '../../core/signal';
import { isEink } from '../../core/theme';
import { route } from '../../core/ui';
import { AddFeature } from './AddFeature';
import { AddPanelButton } from './adding';
import { pack, places, sortedIds, type Placed } from './grid';
import type { GridStore } from './scope';
import { titleOf, type Grid as GridData, type Pos } from './store';

/** The stack being arranged (its store's key), if any. */
export const arranging = signal<string | null>(null);
route.subscribe(() => (arranging.value = null));

const HOLD_MS = 500;
const SLOP = 8; // px a finger may move before a hold counts as a scroll
const MIN_PH = 120; // room for the Arrange handles
const MAX_PH = 4000;
/** Where a hold does not start arranging: there it selects text, edits or drags something else. */
const NO_HOLD = 'input, textarea, select, [contenteditable], .ProseMirror, .ed, .md, .wb-full, .board, .ub-drag, .sortable-chosen, dialog, [popover]';

const calm = () => isEink() || matchMedia('(prefers-reduced-motion: reduce)').matches;

type Drag = {
  id: string;
  kind: 'move' | 'size';
  pointer: number;
  /** The pointer and the page's scroll when the drag began. */
  y0: number;
  scroll0: number;
  lastY: number;
  /** Move: the rows' tops and heights (in page pixels) and where the panel would go. */
  rows: { id: string; top: number; height: number }[];
  from: number;
  to: number;
  /** Size: where the pointer is below the row's bottom edge (kept while the page scrolls or shrinks), and the height now. */
  grab: number;
  h?: number;
};

export function Stack({ place, props, panels, all, store, own }: { place: string; props: any; panels: PanelDef<any>[]; all: PanelDef<any>[]; store: GridStore; own: boolean }) {
  const on = useSignal(arranging) === store.key;
  const [adding, setAdding] = useState(false);
  const Adder = usePanelAdder();
  const root = useRef<HTMLDivElement>(null);
  const top = panels.filter((p) => p.fixed === 'top');
  const bottom = panels.filter((p) => p.fixed === 'bottom');
  const movable = panels.filter((p) => !p.fixed);
  const pos = places(movable, store.saved);
  const byId = new Map(movable.map((p) => [p.id, p]));
  const drawn = sortedIds(
    movable.map((p) => p.id),
    pos,
  )
    .map((id) => ({ p: byId.get(id)!, node: byId.get(id)!.render(props) as VNode | null }))
    .filter((x) => x.node);
  const ids = drawn.map((x) => x.p.id);
  const now = useRef({ ids, pos, drag: null as Drag | null });
  now.current.ids = ids;
  now.current.pos = pos;

  const rowEls = () => {
    const out = new Map<string, HTMLElement>();
    root.current?.querySelectorAll<HTMLElement>(':scope > .lg-row').forEach((el) => out.set(el.dataset.panel!, el));
    return out;
  };

  // ---------- saving ----------

  /** The grid with the drawn panels in this order. Panels never placed by hand get the column the
   *  desktop would give them (packed with the heights they have here), so the computer's layout
   *  stays as it looked; panels not drawn now keep their place. */
  const gridFor = (order: string[], change: Record<string, Partial<Pos>> = {}): GridData => {
    const cur = store.read();
    const p = now.current.pos;
    const els = rowEls();
    const at = pack(order, p as Record<string, Placed>, (id) => els.get(id)?.offsetHeight ?? 200).at;
    const items: Record<string, Pos> = {};
    order.forEach((id, i) => {
      const q = p[id];
      if (!q) return;
      const c = change[id] ?? {};
      const it: Pos = { x: q.auto ? at[id].x : q.x, y: i * 10, w: q.w };
      if (q.h) it.h = q.h;
      const ph = 'ph' in c ? c.ph : q.ph;
      if (ph) it.ph = ph;
      items[id] = it;
    });
    for (const [id, it] of Object.entries(cur?.items ?? {})) if (!items[id]) items[id] = { ...it };
    return { items, removed: cur?.removed ?? [] };
  };
  const save = (order: string[], change: Record<string, Partial<Pos>> = {}) => store.save(gridFor(order, change));

  // ---------- starting: a long press ----------

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let hold: { timer: number; x: number; y: number; target: HTMLElement; pointer: number } | null = null;
    const cancel = () => {
      if (hold) clearTimeout(hold.timer);
      hold = null;
    };
    const fire = () => {
      const h = hold;
      cancel();
      if (!h || arranging.value === store.key) return;
      // A list item picked up by its own drag (it waits a little less) keeps the hold.
      if (h.target.closest('.sortable-chosen')) return;
      arranging.value = store.key;
      navigator.vibrate?.(15);
      window.getSelection()?.removeAllRanges();
      // The hold is not also a tap (a tick, a link) or the browser's own long-press menu.
      const stop = (ev: Event) => (ev.preventDefault(), ev.stopPropagation());
      window.addEventListener('click', stop, { capture: true, once: true });
      window.addEventListener('contextmenu', stop, { capture: true, once: true });
      setTimeout(() => {
        window.removeEventListener('click', stop, { capture: true });
        window.removeEventListener('contextmenu', stop, { capture: true });
      }, 700);
    };
    const down = (e: PointerEvent) => {
      cancel();
      if (arranging.value || !e.isPrimary || e.button !== 0) return;
      const t = e.target as HTMLElement;
      if (!t.closest('.lg-row') || t.closest(NO_HOLD) || document.querySelector('dialog[open]')) return;
      hold = { timer: window.setTimeout(fire, HOLD_MS), x: e.clientX, y: e.clientY, target: t, pointer: e.pointerId };
    };
    const move = (e: PointerEvent) => hold && e.pointerId === hold.pointer && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > SLOP && cancel();
    // A phone's own long press (it comes a little before ours on some phones) starts it too.
    const menu = (e: Event) => {
      if (!hold) return;
      e.preventDefault();
      fire();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('contextmenu', menu);
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', cancel);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('scroll', cancel, { passive: true });
    return () => {
      cancel();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('contextmenu', menu);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', cancel);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('scroll', cancel);
    };
  }, [store.key]);

  // ---------- ending: Done, a tap outside, Back, Escape ----------

  useEffect(() => {
    if (!on) return;
    history.pushState({ ...(history.state ?? {}), arrange: true }, '');
    let popped = false;
    const pop = () => {
      if (history.state?.arrange) return;
      popped = true;
      arranging.value = null;
    };
    const away = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('.lg-row, .lg-arr-bar, dialog, .toast, .files-menu')) return;
      arranging.value = null;
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('dialog[open]') && (arranging.value = null);
    window.addEventListener('popstate', pop);
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('popstate', pop);
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', key);
      if (!popped && history.state?.arrange) history.back();
    };
  }, [on]);
  // Leaving the page (or this pill) ends it.
  useEffect(() => () => void (arranging.value === store.key && (arranging.value = null)), [store.key]);

  // ---------- dragging: up and down, and the height ----------

  const frame = useRef(0);
  const begin = (e: PointerEvent, id: string, kind: Drag['kind']) => {
    if (e.button !== 0 || now.current.drag) return;
    const t = e.target as HTMLElement;
    if (kind === 'move' && t.closest('button:not(.lg-arr-grip)')) return;
    const els = rowEls();
    const row = els.get(id);
    if (!row) return;
    e.preventDefault();
    const rows = now.current.ids.map((k) => {
      const r = els.get(k)!.getBoundingClientRect();
      return { id: k, top: r.top + scrollY, height: r.height };
    });
    const from = now.current.ids.indexOf(id);
    const rb = row.getBoundingClientRect();
    now.current.drag = { id, kind, pointer: e.pointerId, y0: e.clientY, scroll0: scrollY, lastY: e.clientY, rows, from, to: from, grab: e.clientY - rb.bottom };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    row.classList.add(kind === 'move' ? 'lg-row-moving' : 'lg-row-sizing');
    document.body.classList.add('lg-dragging');
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(tick);
  };

  /** Follow the pointer; near the top or bottom of the screen, scroll the page. */
  const tick = () => {
    const d = now.current.drag;
    if (!d) return;
    const edge = 96;
    const bottomEdge = innerHeight - 110; // above the phone's tab bar
    const speed = d.lastY < edge ? -Math.ceil((edge - d.lastY) / 6) : d.lastY > bottomEdge ? Math.ceil((d.lastY - bottomEdge) / 6) : 0;
    if (speed) scrollBy(0, Math.max(-24, Math.min(24, speed)));
    follow();
    frame.current = requestAnimationFrame(tick);
  };

  const follow = () => {
    const d = now.current.drag;
    if (!d) return;
    const els = rowEls();
    if (d.kind === 'size') {
      const row = els.get(d.id);
      if (!row) return;
      d.h = Math.max(MIN_PH, Math.min(MAX_PH, Math.round((d.lastY - d.grab - row.getBoundingClientRect().top) / 10) * 10));
      row.style.height = `${d.h}px`;
      return;
    }
    const dy = d.lastY - d.y0 + (scrollY - d.scroll0);
    const me = d.rows[d.from];
    const mid = me.top + dy + me.height / 2;
    // Where it would go: after every other row whose middle it has passed.
    let to = 0;
    d.rows.forEach((r, i) => i !== d.from && r.top + r.height / 2 < mid && to++);
    d.to = to;
    const gap = d.rows.length > 1 ? Math.max(0, (d.rows[1].top - d.rows[0].top - d.rows[0].height) | 0) : 12;
    d.rows.forEach((r, i) => {
      const el = els.get(r.id);
      if (!el) return;
      if (i === d.from) el.style.transform = `translateY(${dy}px)`;
      else if (d.from < to && i > d.from && i <= to) el.style.transform = `translateY(${-(me.height + gap)}px)`;
      else if (d.from > to && i >= to && i < d.from) el.style.transform = `translateY(${me.height + gap}px)`;
      else el.style.transform = '';
    });
  };

  const end = (e: PointerEvent, cancel = false) => {
    const d = now.current.drag;
    if (!d || e.pointerId !== d.pointer) return;
    now.current.drag = null;
    cancelAnimationFrame(frame.current);
    document.body.classList.remove('lg-dragging');
    const els = rowEls();
    for (const el of els.values()) {
      el.classList.remove('lg-row-moving', 'lg-row-sizing');
      el.style.transition = 'none';
      el.style.transform = '';
    }
    requestAnimationFrame(() => els.forEach((el) => (el.style.transition = '')));
    if (d.kind === 'size') {
      const row = els.get(d.id);
      const was = now.current.pos[d.id]?.ph;
      if (cancel || !d.h || d.h === was) {
        if (row) row.style.height = was ? `${was}px` : '';
        return;
      }
      save(now.current.ids, { [d.id]: { ph: d.h } });
      return;
    }
    if (cancel || d.to === d.from) return;
    const order = now.current.ids.filter((x) => x !== d.id);
    order.splice(d.to, 0, d.id);
    now.current.ids = order;
    save(order);
  };

  useEffect(() => {
    const mv = (e: PointerEvent) => {
      const d = now.current.drag;
      if (!d || e.pointerId !== d.pointer) return;
      e.preventDefault();
      d.lastY = e.clientY;
      follow();
    };
    const up = (e: PointerEvent) => end(e);
    const cancel = (e: PointerEvent) => end(e, true);
    window.addEventListener('pointermove', mv, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      cancelAnimationFrame(frame.current);
    };
  }, []);

  // ---------- the keyboard: the bar's ⠿ ----------

  const keys = (e: KeyboardEvent, id: string) => {
    const order = now.current.ids;
    const i = order.indexOf(id);
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const down = e.key === 'ArrowDown';
    if (e.shiftKey) {
      const h = now.current.pos[id]?.ph ?? rowEls().get(id)?.offsetHeight ?? 200;
      save(order, { [id]: { ph: Math.max(MIN_PH, Math.min(MAX_PH, h + (down ? 40 : -40))) } });
      return;
    }
    const j = i + (down ? 1 : -1);
    if (j < 0 || j >= order.length) return;
    const o = [...order];
    [o[i], o[j]] = [o[j], o[i]];
    save(o);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`.lg-row[data-panel="${CSS.escape(id)}"] .lg-arr-grip`)?.focus());
  };

  const addPanels = () => (own || Adder ? setAdding(true) : store.add());
  const anim = !calm();
  return (
    <div class={`lg-stack ${on ? 'lg-arranging' : ''} ${anim ? 'lg-anim' : ''}`} ref={root} data-place={place} data-no-swipe={on ? '' : undefined}>
      {top.map((p) => (
        <Fixed key={p.id} node={p.render(props)} />
      ))}
      {on && (
        <div class="lg-arr-bar card" role="region" aria-label="Arrange panels">
          <p>
            <strong>Arrange</strong>
            <span class="muted"> · {store.label}</span>
          </p>
          <div class="row tight">
            <button class="ghost small" onClick={addPanels}>
              + {store.addLabel.replace(/…$/, '')}
            </button>
            <button class="ghost small" onClick={store.reset}>
              Reset
            </button>
            <button class="primary small lg-arr-done" onClick={() => (arranging.value = null)}>
              Done
            </button>
          </div>
        </div>
      )}
      {drawn.map(({ p, node }) => {
        const ph = pos[p.id].ph;
        const name = titleOf(p);
        return (
          <div key={p.id} class={`lg-row ${ph ? 'lg-fixed-h' : ''}`} data-panel={p.id} style={ph ? { height: `${ph}px` } : undefined}>
            {node}
            {on && (
              <div class="lg-arr">
                <div class="lg-arr-head" onPointerDown={(e) => begin(e as unknown as PointerEvent, p.id, 'move')}>
                  <button class="lg-arr-grip" aria-label={`Move ${name}`} title="Drag up or down. Arrow keys move it; Shift + arrow keys change its height." onKeyDown={(e) => keys(e as unknown as KeyboardEvent, p.id)}>
                    ⠿
                  </button>
                  <span class="lg-arr-name">{name}</span>
                  <span class="lg-arr-acts">
                    {ph ? (
                      <button class="small" onClick={() => save(now.current.ids, { [p.id]: { ph: null } })}>
                        Auto height
                      </button>
                    ) : null}
                    {!p.alwaysShown && (
                      <button class="small danger" aria-label={`Remove ${name}`} onClick={() => store.remove(p)}>
                        Remove
                      </button>
                    )}
                  </span>
                </div>
                <div class="lg-arr-size" role="presentation" title="Drag to change the height" onPointerDown={(e) => begin(e as unknown as PointerEvent, p.id, 'size')}>
                  <span aria-hidden="true">═</span>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {Adder && store.target && !on && <AddPanelButton onClick={addPanels} />}
      {bottom.map((p) => (
        <Fixed key={p.id} node={p.render(props)} />
      ))}
      {adding && (Adder && store.target ? <Adder.component place={place} {...store.target} onClose={() => setAdding(false)} /> : <AddFeature place={place} all={all} onClose={() => setAdding(false)} />)}
    </div>
  );
}

function Fixed({ node }: { node: VNode | null }) {
  return node;
}
