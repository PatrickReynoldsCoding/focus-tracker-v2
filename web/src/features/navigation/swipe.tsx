// Swipe left or right on a phone to move between the tabs. The page follows the finger and
// springs back at the first and last tab. Ignored over boards, editors, dialogs, whiteboards,
// sticky notes, sliders, fields, anything that scrolls sideways, and while a card is being
// dragged. No motion in E-ink or with prefers-reduced-motion (the page just changes).
// Behind the flag `swipe-tabs` (default on).

import { useEffect, useRef } from 'preact/hooks';
import { useFlag } from '../../core/features';
import { useRoutes, useTabs, type TabDef } from '../../core/registry';
import { isEink } from '../../core/theme';

/** Where a swipe must not start. `data-no-swipe` is for any other feature to opt out. */
const BLOCKED = [
  '.board', '.ed', '.ProseMirror', 'dialog', '[popover]', '.wb-full', '.sticky-layer', '.sticky-wrap', '.more-sheet', '.corner-timer',
  'input', 'textarea', 'select', '[contenteditable]', '[data-no-swipe]', '.sortable-chosen', '.sortable-ghost', '.sortable-drag',
].join(',');

const EDGE = 24; // px: the phone's own edge-swipe back gesture lives here
const phone = () => matchMedia('(max-width: 899px)').matches;
const calm = () => isEink() || matchMedia('(prefers-reduced-motion: reduce)').matches;

/** True when the finger started somewhere a swipe means something else. */
function blockedAt(el: Element | null): boolean {
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    if (e.matches(BLOCKED)) return true;
    const cs = getComputedStyle(e);
    if (/(auto|scroll)/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 1) return true; // scrolls sideways
  }
  return false;
}

export function SwipeTabs({ route }: { route: string }) {
  const on = useFlag('swipe-tabs');
  const tabs = useTabs();
  const routes = useRoutes();
  const head = route.split('/')[1];
  const tabId = (routes.find((x) => x.prefix === `/${head}`)?.tab ?? tabs.find((t) => t.path === `/${head}`)?.id) ?? tabs[0]?.id;
  const at = tabs.findIndex((t) => t.id === tabId);

  // Read by the handlers below, so the listeners stay put (and an animation is not cut short) when the page changes.
  const now = useRef({ tabs, at, route });
  now.current = { tabs, at, route };

  useEffect(() => {
    if (!on) return;
    const neighbour = (dir: 1 | -1): TabDef | undefined => (now.current.at < 0 ? undefined : now.current.tabs[now.current.at + dir]);
    type Start = { x: number; y: number; t: number; mode: 'pending' | 'ignore' | 'swiping' };
    let s: Start | null = null;
    const page = () => document.querySelector<HTMLElement>('main.content');

    const settle = (el: HTMLElement, to: string, then?: () => void) => {
      el.style.transition = 'transform 0.18s ease-out';
      el.style.transform = to;
      let done = false;
      const end = () => {
        if (done) return;
        done = true;
        el.removeEventListener('transitionend', end);
        then?.();
      };
      el.addEventListener('transitionend', end);
      setTimeout(end, 260);
    };
    const reset = (el: HTMLElement) => {
      el.style.transition = '';
      el.style.transform = '';
    };

    const start = (e: TouchEvent) => {
      s = null;
      if (e.touches.length !== 1 || !phone() || document.querySelector('dialog[open], .more-sheet')) return;
      const t = e.touches[0];
      if (t.clientX < EDGE || t.clientX > innerWidth - EDGE) return;
      s = { x: t.clientX, y: t.clientY, t: Date.now(), mode: blockedAt(e.target as Element) ? 'ignore' : 'pending' };
    };
    const move = (e: TouchEvent) => {
      if (!s || s.mode === 'ignore') return;
      if (e.touches.length !== 1) {
        s.mode = 'ignore';
        const el = page();
        if (el) reset(el);
        return;
      }
      const dx = e.touches[0].clientX - s.x;
      const dy = e.touches[0].clientY - s.y;
      if (s.mode === 'pending') {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return void (s.mode = 'ignore'); // scrolling
        if (Math.abs(dx) < 12 || Math.abs(dx) < 1.6 * Math.abs(dy)) return;
        if (document.querySelector('.sortable-chosen, .sortable-drag, dialog[open]')) return void (s.mode = 'ignore');
        s.mode = 'swiping';
      }
      if (e.cancelable) e.preventDefault();
      const el = page();
      if (!el || calm()) return;
      const has = !!neighbour(dx < 0 ? 1 : -1);
      el.style.transition = 'none';
      el.style.transform = `translateX(${has ? dx : dx * 0.25}px)`; // heavy at the ends
    };
    const end = (e: TouchEvent) => {
      const cur = s;
      s = null;
      if (!cur || cur.mode !== 'swiping') return;
      const el = page();
      const dx = (e.changedTouches[0]?.clientX ?? cur.x) - cur.x;
      const dir: 1 | -1 = dx < 0 ? 1 : -1;
      const next = neighbour(dir);
      const fast = Math.abs(dx) / Math.max(1, Date.now() - cur.t) > 0.5 && Math.abs(dx) > 40;
      const go = !!next && e.type !== 'touchcancel' && (Math.abs(dx) > innerWidth * 0.3 || fast);
      const target = next ? `#${next.href?.(now.current.route) ?? next.path}` : '';
      if (!go) {
        if (el) settle(el, 'translateX(0)', () => reset(el));
        return;
      }
      if (!el || calm()) {
        if (el) reset(el);
        location.hash = target;
        return;
      }
      // Slide this page out, then bring the next one in from the other side.
      settle(el, `translateX(${-dir * 100}%)`, () => {
        location.hash = target;
        el.style.transition = 'none';
        el.style.transform = `translateX(${dir * 60}px)`;
        requestAnimationFrame(() => requestAnimationFrame(() => settle(el, 'translateX(0)', () => reset(el))));
      });
    };

    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end);
    document.addEventListener('touchcancel', end);
    return () => {
      document.removeEventListener('touchstart', start);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end);
      document.removeEventListener('touchcancel', end);
      const el = page();
      if (el) reset(el);
    };
  }, [on]);

  return null;
}
