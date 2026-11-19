// Sticky notes floating over a project's page (V1-GAPS 38). Drag one by its top strip, resize it
// from its corner (or pinch it with two fingers), type in it. ⋯ has 15 colours and a paper slider
// (only the paper goes see-through, never the text); × deletes it, with Undo.
// Places follow v1, so imported notes land where they were: x is a percentage of the page's
// width, y pixels from the top of the page, w and h pixels. On a narrow screen a note is drawn
// inside the page (left edge and width clamped in CSS); what is saved changes only when it moves.
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, del, mode, newId, optimistic, post, say } from '../../core/api';
import { useData } from '../../core/ui';
import { clamp, LIMITS, patternOf, shadeOf, STICKY_SHADES } from './colours';

type Note = { id: string; project_id: string; text: string | null; color: string | null; opacity: number | null; x: number | null; y: number | null; w: number | null; h: number | null; created?: string };
type Place = { left: number; top: number; w: number; h: number };

const SAVE_MS = 800;
const HIDDEN_KEY = 'ft.stickies.hidden';
const readHidden = () => {
  try {
    return localStorage.getItem(HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
};

/** Saved values with v1's defaults for anything missing (imported rows may lack some). */
const norm = (n: Note) => ({
  x: clamp(n.x ?? 62, 0, 100),
  y: Math.max(0, n.y ?? 0),
  w: clamp(n.w ?? 220, LIMITS.w[0], LIMITS.w[1]),
  h: clamp(n.h ?? 180, LIMITS.h[0], LIMITS.h[1]),
  opacity: clamp(n.opacity ?? 1, LIMITS.opacity[0], 1),
});
const round2 = (n: number) => Math.round(n * 100) / 100;

export function StickyLayer({ projectId }: { projectId: string }) {
  const { data, setData } = useData<Note[]>(`/stickies?project_id=${encodeURIComponent(projectId)}`);
  const layer = useRef<HTMLDivElement>(null);
  const [hidden, setHiddenState] = useState(readHidden);
  const [menu, setMenu] = useState<{ id: string; alignLeft: boolean } | null>(null);
  // A note being dragged, resized or pinched: drawn from here (pixels) until it is let go.
  const [live, setLive] = useState<{ id: string } & Place | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  // Changes not confirmed by the server yet, laid over what it sends, so a reload never puts older text back.
  const unsent = useRef<Record<string, Partial<Note>>>({});
  const timers = useRef<Record<string, number>>({});
  // A note's first save waits for the note to exist on the server.
  const making = useRef<Record<string, Promise<unknown>>>({});

  const notes = (data ?? []).map((n) => ({ ...n, ...unsent.current[n.id] }));

  async function flush(id: string, keepalive = false) {
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    const fields = unsent.current[id];
    if (!fields || !Object.keys(fields).length) return;
    const sent = { ...fields };
    const pendingCreate = making.current[id] as Promise<unknown> | undefined;
    if (pendingCreate) await pendingCreate;
    if (keepalive) {
      fetch(`/api/stickies/${id}`, {
        method: 'PATCH',
        keepalive: true,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-FT-Client': 'web', 'X-Mode': mode.value },
        body: JSON.stringify(sent),
      }).catch(() => {});
      return;
    }
    try {
      await api('PATCH', `/stickies/${id}`, sent);
      const u = unsent.current[id];
      if (u) {
        for (const k of Object.keys(sent) as (keyof Note)[]) if (u[k] === sent[k]) delete u[k];
        if (!Object.keys(u).length) delete unsent.current[id];
      }
    } catch (e) {
      delete unsent.current[id];
      say(`Note not saved: ${(e as Error).message}`, 'error');
    }
  }

  /** Change a note on screen, and save it shortly after the last change (one save while typing). */
  function edit(id: string, fields: Partial<Note>, delay = SAVE_MS) {
    unsent.current[id] = { ...unsent.current[id], ...fields };
    setData((d) => d.map((n) => (n.id === id ? { ...n, ...fields } : n)));
    clearTimeout(timers.current[id]);
    timers.current[id] = window.setTimeout(() => flush(id), delay);
  }

  // Save what is waiting when the page goes away or this project page closes.
  useEffect(() => {
    const away = () => Object.keys(unsent.current).forEach((id) => flush(id, true));
    const hide = () => document.visibilityState === 'hidden' && away();
    window.addEventListener('pagehide', away);
    document.addEventListener('visibilitychange', hide);
    return () => {
      window.removeEventListener('pagehide', away);
      document.removeEventListener('visibilitychange', hide);
      Object.keys(timers.current).forEach((id) => flush(id));
    };
  }, [projectId]);

  // The options menu closes on a click outside it, or with Esc.
  useEffect(() => {
    if (!menu) return;
    const click = (e: Event) => {
      const t = e.target as HTMLElement;
      if (!t.closest?.(`[data-sticky="${menu.id}"]`)) setMenu(null);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    document.addEventListener('pointerdown', click);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', click);
      document.removeEventListener('keydown', key);
    };
  }, [menu?.id]);

  useEffect(() => {
    if (!focusId) return;
    const el = layer.current?.querySelector<HTMLElement>(`[data-sticky="${focusId}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 60 || r.bottom > window.innerHeight - 80) el.scrollIntoView({ block: 'center' });
    el.querySelector('textarea')?.focus({ preventScroll: true });
    setFocusId(null);
  }, [focusId, data]);

  const width = () => layer.current?.clientWidth || window.innerWidth;

  /** Where a new note goes: in view, at the right, stepping past notes already there. */
  function freeSpot(w: number, h: number) {
    const box = layer.current?.getBoundingClientRect();
    const viewTop = Math.max(0, -(box?.top ?? 0) + 72);
    const W = width();
    const left = (x: number) => clamp((x / 100) * W, 0, Math.max(0, W - w));
    const taken = notes.map((n) => {
      const p = norm(n);
      return { l: left(p.x), t: p.y, r: left(p.x) + Math.min(p.w, W), b: p.y + p.h };
    });
    for (let y = viewTop; y < viewTop + 2000; y += 24) {
      for (const x of [62, 30, 0]) {
        const l = left(x);
        if (!taken.some((o) => o.l < l + w && o.r > l && o.t < y + h && o.b > y)) return { x, y: Math.round(y) };
      }
    }
    return { x: 62, y: Math.round(viewTop) };
  }

  function add() {
    const w = Math.min(220, Math.max(LIMITS.w[0], width() - 16));
    const spot = freeSpot(w, 180);
    const note: Note = { id: newId(), project_id: projectId, text: '', color: 'yellow', opacity: 1, x: spot.x, y: spot.y, w, h: 180 };
    if (hidden) setHidden(false);
    const made = optimistic(
      () => {
        setData((d) => [...d, note]);
        setFocusId(note.id);
        return () => setData((d) => d.filter((n) => n.id !== note.id));
      },
      () => post('/stickies', note),
    );
    making.current[note.id] = made.finally(() => delete making.current[note.id]);
  }

  function remove(n: Note) {
    clearTimeout(timers.current[n.id]);
    delete timers.current[n.id];
    delete unsent.current[n.id];
    setMenu(null);
    optimistic(
      () => {
        setData((d) => d.filter((x) => x.id !== n.id));
        return () => setData((d) => [...d, n]);
      },
      () => del(`/stickies/${n.id}`),
      'Sticky note deleted',
    );
  }

  function setHidden(on: boolean) {
    setHiddenState(on);
    setMenu(null);
    try {
      localStorage.setItem(HIDDEN_KEY, on ? '1' : '0');
    } catch {
      /* private mode */
    }
  }

  /** Let go of a note that was moved or resized: save its place as the page's width sees it. */
  function settle(id: string, p: Place) {
    setLive(null);
    const W = width();
    edit(id, { x: round2(clamp((p.left / W) * 100, 0, 100)), y: Math.round(clamp(p.top, 0, LIMITS.y[1])), w: Math.round(p.w), h: Math.round(p.h) }, 0);
  }

  function placeOf(el: HTMLElement): Place {
    return { left: el.offsetLeft, top: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
  }

  /** Drag by the strip, or resize from the corner, with a mouse, pen or one finger. */
  function startPointer(e: PointerEvent, n: Note, how: 'move' | 'size') {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button:not(.sticky-resize)')) return;
    const el = (e.currentTarget as HTMLElement).closest<HTMLElement>('.sticky-wrap')!;
    const start = placeOf(el);
    const sx = e.clientX;
    const sy = e.clientY;
    const W = width();
    let p = start;
    let moved = false;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      moved = true;
      p =
        how === 'move'
          ? { ...start, left: clamp(start.left + dx, 0, Math.max(0, W - start.w)), top: Math.max(0, start.top + dy) }
          : { ...start, w: clamp(start.w + dx, LIMITS.w[0], Math.min(LIMITS.w[1], W - start.left)), h: clamp(start.h + dy, LIMITS.h[0], LIMITS.h[1]) };
      setLive({ id: n.id, ...p });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (moved) settle(n.id, p);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /** Two fingers on a note resize it (kept on screen, at most the page's width). */
  function startPinch(e: TouchEvent, n: Note) {
    if (e.touches.length !== 2) return;
    const el = e.currentTarget as HTMLElement;
    const gap = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
    const g0 = gap(e.touches);
    const start = placeOf(el);
    const W = width();
    let p = start;
    e.preventDefault();
    const move = (ev: TouchEvent) => {
      if (ev.touches.length !== 2) return;
      ev.preventDefault();
      const k = gap(ev.touches) / g0;
      const w = clamp(start.w * k, LIMITS.w[0], Math.min(LIMITS.w[1], W));
      const h = clamp(start.h * k, LIMITS.h[0], LIMITS.h[1]);
      p = { left: clamp(start.left, 0, Math.max(0, W - w)), top: start.top, w, h };
      setLive({ id: n.id, ...p });
    };
    const end = (ev: TouchEvent) => {
      if (ev.touches.length >= 2) return;
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
      if (p !== start) settle(n.id, p);
    };
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
  }

  if (!data) return null;
  return (
    <>
      <div class="sticky-layer" ref={layer} aria-hidden={hidden ? 'true' : undefined}>
        {!hidden &&
          notes.map((n) => {
            const p = norm(n);
            const l = live?.id === n.id ? live : null;
            const style = l
              ? { left: `${l.left}px`, top: `${l.top}px`, width: `${l.w}px`, height: `${l.h}px` }
              : { left: `max(0px, min(${p.x}%, calc(100% - ${p.w}px)))`, top: `${p.y}px`, width: `min(${p.w}px, 100%)`, height: `${p.h}px` };
            const open = menu?.id === n.id;
            return (
              <div
                key={n.id}
                class={`sticky-wrap ${l ? 'moving' : ''}`}
                data-sticky={n.id}
                style={{ ...style, '--paper': shadeOf(n.color), '--paper-a': p.opacity }}
                onTouchStart={(e) => startPinch(e as unknown as TouchEvent, n)}
              >
                <div class="sticky" role="group" aria-label="Sticky note">
                  <div class="sticky-strip" data-pat={patternOf(n.color)} onPointerDown={(e) => startPointer(e as unknown as PointerEvent, n, 'move')} title="Drag to move">
                    <button
                      class="sticky-btn"
                      aria-label="Note colour and paper"
                      aria-expanded={open}
                      onClick={(e) => {
                        const wrap = (e.currentTarget as HTMLElement).closest<HTMLElement>('.sticky-wrap')!;
                        setMenu(open ? null : { id: n.id, alignLeft: wrap.offsetLeft + wrap.offsetWidth < 240 });
                      }}
                    >
                      ⋯
                    </button>
                    <button class="sticky-btn" aria-label="Delete note" title="Delete note" onClick={() => remove(n)}>
                      ×
                    </button>
                  </div>
                  <textarea
                    value={n.text ?? ''}
                    placeholder="Note…"
                    aria-label="Note text"
                    maxLength={5000}
                    onInput={(e) => edit(n.id, { text: (e.target as HTMLTextAreaElement).value })}
                    onBlur={() => flush(n.id)}
                  />
                  <button class="sticky-resize" aria-label="Resize note" title="Drag to resize" tabIndex={-1} onPointerDown={(e) => startPointer(e as unknown as PointerEvent, n, 'size')} />
                </div>
                {open && (
                  <div class={`sticky-menu ${menu!.alignLeft ? 'left' : ''}`} role="dialog" aria-label="Note options">
                    <div class="small muted">Colour</div>
                    <div class="sticky-swatches" role="radiogroup" aria-label="Colour">
                      {STICKY_SHADES.map(([name, shade]) => (
                        <button
                          key={name}
                          role="radio"
                          aria-checked={(n.color ?? 'yellow') === name}
                          aria-label={name}
                          title={name}
                          class="sticky-dot"
                          data-pat={patternOf(name)}
                          style={{ background: shade }}
                          onClick={() => edit(n.id, { color: name }, 0)}
                        />
                      ))}
                    </div>
                    <label class="small muted">
                      Paper
                      <input
                        type="range"
                        min={LIMITS.opacity[0]}
                        max={1}
                        step={0.05}
                        value={p.opacity}
                        aria-label="How solid the paper is"
                        onInput={(e) => edit(n.id, { opacity: Number((e.target as HTMLInputElement).value) }, 500)}
                      />
                      <span class="sticky-range">
                        <span>See-through</span>
                        <span>Solid</span>
                      </span>
                    </label>
                  </div>
                )}
              </div>
            );
          })}
      </div>
      <div class="sticky-fab">
        {(notes.length > 0 || hidden) && (
          <button onClick={() => setHidden(!hidden)} aria-label={hidden ? `Show ${notes.length} sticky notes` : 'Hide sticky notes'}>
            {hidden ? `Show notes` : 'Hide notes'}
            {hidden && notes.length > 0 && <span class="badge">{notes.length}</span>}
          </button>
        )}
        <button onClick={add}>+ Note</button>
      </div>
    </>
  );
}
