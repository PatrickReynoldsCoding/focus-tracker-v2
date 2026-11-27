// A floating box (the Pomodoro and session timers) the owner can move. A mouse
// drags at once; a finger holds still for a moment first, so a swipe over the
// box still scrolls the page. Buttons inside stay taps. Where it is left is kept
// on this device as a distance from the nearest left/right and top/bottom
// edges, so it stays near the same corner when the window changes size, and it
// is always kept fully on screen. With nothing kept, the CSS puts it in its
// usual corner; a double-click (or double tap) on the grip goes back there.

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

export type Spot = { h: 'left' | 'right'; x: number; v: 'top' | 'bottom'; y: number };
type Box = { w: number; h: number };
type Place = { left: number; top: number };

const MARGIN = 4;
const HOLD_MS = 350;
const SLOP = 8;
const MOUSE_SLOP = 4;
const DOUBLE_TAP_MS = 400;
const NOT_A_HANDLE = 'button, a, input, select, textarea, [contenteditable]';
export const GRIP_TITLE = 'Drag to move. Double-click to put it back in the corner.';

function load(key: string): Spot | null {
  try {
    const s = JSON.parse(localStorage.getItem(key) ?? 'null');
    const ok = s && (s.h === 'left' || s.h === 'right') && (s.v === 'top' || s.v === 'bottom') && Number.isFinite(s.x) && Number.isFinite(s.y);
    return ok ? s : null;
  } catch {
    return null;
  }
}

function save(key: string, s: Spot | null) {
  try {
    if (s) localStorage.setItem(key, JSON.stringify(s));
    else localStorage.removeItem(key);
  } catch {
    /* private mode */
  }
}

const viewport = (): Box => ({ w: document.documentElement.clientWidth || innerWidth, h: document.documentElement.clientHeight || innerHeight });
const clamp = (v: number, size: number, room: number) => Math.max(MARGIN, Math.min(room - size - MARGIN, v));

/** The top-left corner for a box at this place, kept fully on screen. */
export function keepOnScreen(p: Place, box: Box, view: Box): Place {
  return { left: clamp(p.left, box.w, view.w), top: clamp(p.top, box.h, view.h) };
}

/** A spot as distances from the edges nearest the box's middle. */
export function spotOf(p: Place, box: Box, view: Box): Spot {
  const left = p.left + box.w / 2 < view.w / 2;
  const top = p.top + box.h / 2 < view.h / 2;
  return {
    h: left ? 'left' : 'right',
    x: Math.round(left ? p.left : view.w - box.w - p.left),
    v: top ? 'top' : 'bottom',
    y: Math.round(top ? p.top : view.h - box.h - p.top),
  };
}

/** Where a box goes for a kept spot in this window. */
export function placeOf(s: Spot, box: Box, view: Box): Place {
  const left = s.h === 'left' ? s.x : view.w - box.w - s.x;
  const top = s.v === 'top' ? s.y : view.h - box.h - s.y;
  return keepOnScreen({ left, top }, box, view);
}

function swallowClick() {
  const stop = (e: Event) => (e.preventDefault(), e.stopPropagation());
  addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => removeEventListener('click', stop, { capture: true }), 600);
}

/**
 * Makes a fixed box movable. Put `ref` and `onPointerDown` on the box, and
 * `gripProps` on a small grip inside it; `moving` is true while it is dragged.
 * `onReset` runs after a double-click on the grip, to forget older choices too.
 */
export function useDraggable<T extends HTMLElement>(key: string, onReset?: () => void) {
  const ref = useRef<T>(null);
  const spot = useRef<Spot | null>(load(key));
  const live = useRef<Place | null>(null);
  const lastTap = useRef(0);
  const [moving, setMoving] = useState(false);
  const [, redraw] = useState(0);

  const apply = () => {
    const el = ref.current;
    if (!el) return;
    const st = el.style;
    if (!live.current && !spot.current) {
      st.left = st.top = st.right = st.bottom = '';
      return;
    }
    const r = el.getBoundingClientRect();
    const box = { w: r.width, h: r.height };
    const p = live.current ? keepOnScreen(live.current, box, viewport()) : placeOf(spot.current!, box, viewport());
    st.left = `${p.left}px`;
    st.top = `${p.top}px`;
    st.right = st.bottom = 'auto';
  };

  // Every render: the box may have changed size (its text), or just appeared.
  useLayoutEffect(apply);
  useEffect(() => {
    addEventListener('resize', apply);
    return () => removeEventListener('resize', apply);
  }, []);

  const reset = () => {
    spot.current = null;
    save(key, null);
    onReset?.();
    apply();
    redraw((n) => n + 1);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const t = e.target as HTMLElement;
    const el = ref.current;
    if (!el || t.closest(NOT_A_HANDLE)) return;
    const touch = e.pointerType !== 'mouse';
    const r = el.getBoundingClientRect();
    const p = { id: e.pointerId, x0: e.clientX, y0: e.clientY, gx: e.clientX - r.left, gy: e.clientY - r.top, box: { w: r.width, h: r.height }, ready: !touch, active: false, timer: 0, grip: !!t.closest('.drag-grip') };
    const capture = () => {
      try {
        el.setPointerCapture(p.id);
      } catch {
        /* the pointer is gone */
      }
    };
    if (touch) {
      el.classList.add('drag-pressing');
      p.timer = window.setTimeout(() => {
        p.ready = true;
        el.classList.remove('drag-pressing');
        el.classList.add('drag-ready');
        navigator.vibrate?.(12);
        capture();
      }, HOLD_MS);
    }
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== p.id) return;
      const far = Math.hypot(ev.clientX - p.x0, ev.clientY - p.y0);
      if (!p.active) {
        if (!p.ready) return far > SLOP ? finish() : undefined; // a finger moving before the hold: a scroll
        if (!touch && far < MOUSE_SLOP) return;
        p.active = true;
        setMoving(true);
        capture();
      }
      ev.preventDefault();
      live.current = { left: ev.clientX - p.gx, top: ev.clientY - p.gy };
      apply();
    };
    const block = (ev: TouchEvent) => p.ready && ev.cancelable && ev.preventDefault();
    const noMenu = (ev: Event) => ev.preventDefault();
    // A draggable thing under the timer (a file card) must not start the browser's own drag and cancel ours.
    const noNativeDrag = (ev: Event) => ev.preventDefault();
    const up = (ev: PointerEvent) => ev.pointerId === p.id && finish(ev.type === 'pointerup');
    const finish = (released = false) => {
      clearTimeout(p.timer);
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      document.removeEventListener('touchmove', block);
      document.removeEventListener('dragstart', noNativeDrag, true);
      el.removeEventListener('contextmenu', noMenu);
      el.classList.remove('drag-pressing', 'drag-ready');
      if (p.active && live.current) {
        const view = viewport();
        spot.current = spotOf(keepOnScreen(live.current, p.box, view), p.box, view);
        save(key, spot.current);
      }
      // A mouse drag, or a finger's hold let go in place, is not a tap (a finger that moved sends no click).
      if (touch ? p.ready && !p.active : p.active) swallowClick();
      else if (touch && released && p.grip) {
        const now = Date.now();
        if (now - lastTap.current < DOUBLE_TAP_MS) {
          swallowClick(); // the box leaves; its click must not land on what was under it
          reset();
        }
        lastTap.current = now;
      }
      live.current = null;
      if (p.active) setMoving(false);
      apply();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    document.addEventListener('touchmove', block, { passive: false });
    document.addEventListener('dragstart', noNativeDrag, true);
    if (touch) el.addEventListener('contextmenu', noMenu);
  };

  const gripProps = { class: 'drag-grip', title: GRIP_TITLE, 'aria-hidden': true as const, onDblClick: reset };
  return { ref, onPointerDown, gripProps, moving };
}
