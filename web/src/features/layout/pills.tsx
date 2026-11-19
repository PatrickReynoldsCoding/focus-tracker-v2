// Today on a phone (V1-GAPS 40, flag `today-pills`): the focus card pinned at the top, a row of
// pills, and the chosen pill's panels one under the other. A pill is a name, an optional icon and
// any Today panels in an order (also notes, lists and whiteboards not on the desktop's Today).
// Swiping on the panels changes pill (a swipe anywhere else still changes tab). Pills and their
// switches are saved per mode on the server (layout.today.pills / .view); with none saved, each
// Today panel is its own pill.

import type { VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { localStorageSet, mode } from '../../core/api';
import { useFlags } from '../../core/features';
import { lookupPanel, type PanelDef, type PanelLayoutProps } from '../../core/registry';
import { useSignal } from '../../core/signal';
import { isEink } from '../../core/theme';
import { TodaySettings } from './TodaySettings';
import { MAX_PILLS, PHONE, PILL_NAME_MAX, PINNED, titleOf, useLayout, useMedia, type Pill } from './store';

/** A short name for a pill made from a panel. */
export const shortName = (title: string) => ([...title].length > PILL_NAME_MAX ? [...title].slice(0, PILL_NAME_MAX - 1).join('') + '…' : title);

/** With no pills saved: each Today panel is its own pill (removed ones left out); past 12 the last holds the rest. */
export function defaultPills(panels: PanelDef<any>[], removed: string[]): Pill[] {
  const list = panels.filter((p) => !p.fixed && p.id !== PINNED && !removed.includes(p.id));
  const pills: Pill[] = list.map((p) => ({ id: p.id.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40), name: shortName(titleOf(p)), icon: null, panels: [p.id] }));
  if (pills.length <= MAX_PILLS) return pills;
  const more: Pill = { id: 'more', name: 'More', icon: null, panels: pills.slice(MAX_PILLS - 1).flatMap((p) => p.panels) };
  return [...pills.slice(0, MAX_PILLS - 1), more];
}

/** The pill chosen in this page load, per mode (kept even when "open on the pill I used last" is off). */
const chosenNow = new Map<string, string>();
const lastKey = (m: string) => `ft.pills.${m}`;
const readLast = (m: string) => {
  try {
    return localStorage.getItem(lastKey(m));
  } catch {
    return null;
  }
};

export function PillsLayout({ place, props, panels, next }: PanelLayoutProps) {
  const phone = useMedia(PHONE);
  if (!phone) return next(panels);
  return <Pills place={place} props={props} panels={panels} />;
}

/** Where a swipe means something else (the same places the tab swipe leaves alone). */
const BLOCKED = '.board, .ed, .ProseMirror, dialog, [popover], .wb-full, input, textarea, select, [contenteditable], .sortable-chosen, .sortable-drag';
function blockedAt(el: Element | null, stop: Element): boolean {
  for (let e = el; e && e !== stop; e = e.parentElement) {
    if (e.matches(BLOCKED)) return true;
    const cs = getComputedStyle(e);
    if (/(auto|scroll)/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 1) return true;
  }
  return false;
}
const calm = () => isEink() || matchMedia('(prefers-reduced-motion: reduce)').matches;

function Pills({ place, props, panels }: { place: string; props: any; panels: PanelDef<any>[] }) {
  const m = useSignal(mode);
  const flags = useFlags();
  const data = useLayout(place);
  const [settings, setSettings] = useState(false);
  const view = data?.view ?? {};
  const removed = data?.grid?.removed ?? [];
  const pills = data?.pills ?? defaultPills(panels, removed);
  const byId = new Map(panels.map((p) => [p.id, p]));

  /** A pill's panels, drawn: Today's own, else drawn on their own (a list not on Today). */
  const drawn = (pill: Pill) =>
    pill.panels
      .map((id) => {
        const p = byId.get(id) ?? lookupPanel(place, id, flags);
        if (!p || p.fixed || p.id === PINNED) return null;
        const node = p.render(props) as VNode | null;
        return node ? { p, node } : null;
      })
      .filter(Boolean) as { p: PanelDef<any>; node: VNode }[];
  // A pill whose panels have nothing to show now is left out of the row (an empty pill stays: it says so).
  const shown = pills.map((pill) => ({ pill, items: drawn(pill) })).filter((x) => !x.pill.panels.length || x.items.length);

  const [chosen, setChosenState] = useState<string | null>(() => chosenNow.get(m) ?? (view.pillLast !== false ? readLast(m) : null));
  useEffect(() => setChosenState(chosenNow.get(m) ?? (view.pillLast !== false ? readLast(m) : null)), [m]);
  const at = Math.max(0, shown.findIndex((x) => x.pill.id === chosen));
  const current = shown[at];
  const choose = (id: string) => {
    // A field being typed in is left first, so it saves.
    (document.activeElement as HTMLElement | null)?.blur?.();
    chosenNow.set(m, id);
    localStorageSet(lastKey(m), id);
    setChosenState(id);
  };

  // The chosen pill stays in view in its row (the row scrolls, the page never moves sideways).
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const r = row.current;
    const b = r?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!r || !b) return;
    if (b.offsetLeft < r.scrollLeft) r.scrollLeft = b.offsetLeft - 8;
    else if (b.offsetLeft + b.offsetWidth > r.scrollLeft + r.clientWidth) r.scrollLeft = b.offsetLeft + b.offsetWidth - r.clientWidth + 8;
  }, [current?.pill.id]);

  // ---------- swipe on the panels: the pill before or after ----------
  const area = useRef<HTMLDivElement>(null);
  const swipeOn = view.pillSwipe !== false;
  const now = useRef({ at, n: shown.length, ids: shown.map((x) => x.pill.id) });
  now.current = { at, n: shown.length, ids: shown.map((x) => x.pill.id) };
  useEffect(() => {
    const el = area.current;
    if (!el || !swipeOn) return;
    let s: { x: number; y: number; t: number; mode: 'pending' | 'swiping' | 'ignore' } | null = null;
    const reset = () => {
      el.style.transition = '';
      el.style.transform = '';
    };
    const start = (e: TouchEvent) => {
      s = null;
      if (e.touches.length !== 1 || document.querySelector('dialog[open]')) return;
      const t = e.touches[0];
      s = { x: t.clientX, y: t.clientY, t: Date.now(), mode: blockedAt(e.target as Element, el) ? 'ignore' : 'pending' };
    };
    const move = (e: TouchEvent) => {
      if (!s || s.mode === 'ignore') return;
      const dx = e.touches[0].clientX - s.x;
      const dy = e.touches[0].clientY - s.y;
      if (s.mode === 'pending') {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return void (s.mode = 'ignore');
        if (Math.abs(dx) < 12 || Math.abs(dx) < 1.6 * Math.abs(dy)) return;
        s.mode = 'swiping';
      }
      if (e.cancelable) e.preventDefault();
      if (calm()) return;
      const { at: i, n } = now.current;
      const has = dx < 0 ? i < n - 1 : i > 0;
      el.style.transition = 'none';
      el.style.transform = `translateX(${has ? dx : dx * 0.25}px)`; // heavy at the first and last pill
    };
    const end = (e: TouchEvent) => {
      const cur = s;
      s = null;
      if (!cur || cur.mode !== 'swiping') return;
      const dx = (e.changedTouches[0]?.clientX ?? cur.x) - cur.x;
      const { at: i, n, ids } = now.current;
      const j = i + (dx < 0 ? 1 : -1);
      const fast = Math.abs(dx) / Math.max(1, Date.now() - cur.t) > 0.5 && Math.abs(dx) > 40;
      const go = j >= 0 && j < n && e.type !== 'touchcancel' && (Math.abs(dx) > el.clientWidth * 0.25 || fast);
      if (calm()) {
        reset();
        if (go) choose(ids[j]);
        return;
      }
      el.style.transition = 'transform 0.16s ease-out';
      if (!go) {
        el.style.transform = 'translateX(0)';
        setTimeout(reset, 180);
        return;
      }
      el.style.transform = `translateX(${dx < 0 ? -40 : 40}px)`;
      setTimeout(() => {
        choose(ids[j]);
        el.style.transition = 'none';
        el.style.transform = `translateX(${dx < 0 ? 40 : -40}px)`;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          el.style.transition = 'transform 0.16s ease-out';
          el.style.transform = 'translateX(0)';
          setTimeout(reset, 180);
        }));
      }, 120);
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
      reset();
    };
  }, [swipeOn]);

  const keys = (e: KeyboardEvent) => {
    const i = shown.findIndex((x) => x.pill.id === current?.pill.id);
    const j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? shown.length - 1 : -2;
    if (j === -2 || j < 0 || j >= shown.length) return;
    e.preventDefault();
    choose(shown[j].pill.id);
    requestAnimationFrame(() => row.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
  };

  const focus = byId.get(PINNED);
  const card = view.focusCard ?? 'compact';
  const countOf = (pill: Pill) =>
    pill.panels
      .map((id) => byId.get(id)?.count?.(props))
      .filter((c) => c !== null && c !== undefined && c !== '')
      .join(' · ');

  return (
    <div class="pl-page">
      {panels
        .filter((p) => p.fixed === 'top')
        .map((p) => (
          <Slot key={p.id} node={p.render(props)} />
        ))}
      {focus && card !== 'hidden' && <Slot key={`focus-${card}`} node={(card === 'compact' && focus.compact ? focus.compact(props) : focus.render(props)) as VNode | null} />}
      <div class="pl-bar">
        <div class="pl-row" role="tablist" aria-label="Today’s pills" ref={row} onKeyDown={(e) => keys(e as unknown as KeyboardEvent)}>
          {shown.map(({ pill }, i) => {
            const on = i === at;
            const c = view.pillCounts !== false ? countOf(pill) : '';
            return (
              <button key={pill.id} role="tab" class={`pl-pill ${on ? 'on' : ''}`} aria-selected={on} tabIndex={on ? 0 : -1} aria-controls="pl-panels" onClick={() => choose(pill.id)}>
                {pill.icon && <span aria-hidden="true">{pill.icon}</span>}
                <span>{pill.name}</span>
                {c && <span class="pl-count">{c}</span>}
              </button>
            );
          })}
        </div>
        <button class="pl-gear icon" aria-label="Today settings" title="Today settings" onClick={() => setSettings(true)}>
          ⚙
        </button>
      </div>
      <div id="pl-panels" class="pl-panels" role="tabpanel" aria-label={current?.pill.name ?? 'Today'} ref={area} data-no-swipe={swipeOn ? '' : undefined}>
        {!current ? (
          <p class="empty">No pills yet. Today settings makes them.</p>
        ) : current.items.length ? (
          current.items.map(({ p, node }) => <Slot key={p.id} node={node} />)
        ) : (
          <div class="card pl-empty">
            <p class="muted">This pill has no panels yet.</p>
            <button class="primary" onClick={() => setSettings(true)}>
              Add panels
            </button>
          </div>
        )}
      </div>
      {panels
        .filter((p) => p.fixed === 'bottom')
        .map((p) => (
          <Slot key={p.id} node={p.render(props)} />
        ))}
      {settings && <TodaySettings place={place} panels={panels} pills={pills} saved={!!data?.pills} view={view} onClose={() => setSettings(false)} />}
    </div>
  );
}

function Slot({ node }: { node: VNode | null }) {
  return node;
}
