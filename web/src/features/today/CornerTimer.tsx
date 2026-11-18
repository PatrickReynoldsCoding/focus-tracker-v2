// A small timer in a corner of every page while a session runs (not on Today,
// where the focus card shows it). Drag it with a mouse or a finger and it
// snaps to the nearest corner; tap it to open the focus project; ✕ hides it.
// Corner and hidden state are kept on this device.

import { useEffect, useRef, useState } from 'preact/hooks';
import { signal, useSignal } from '../../core/signal';
import { go } from '../../core/ui';
import { clock, useSession } from './session';

type Corner = 'tl' | 'tr' | 'bl' | 'br';

function read(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function write(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
}

const hiddenSig = signal(read('ft.timer.hidden') === '1');
export const cornerHidden = () => hiddenSig.value;
export function setCornerHidden(h: boolean) {
  hiddenSig.value = h;
  write('ft.timer.hidden', h ? '1' : '0');
}
export const useCornerHidden = () => useSignal(hiddenSig);

export function CornerTimer({ route }: { route: string }) {
  const { live: l } = useSession();
  const hidden = useCornerHidden();
  const [corner, setCorner] = useState<Corner>(() => {
    const c = read('ft.timer.corner');
    return c === 'tl' || c === 'tr' || c === 'bl' || c === 'br' ? c : 'bl';
  });
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ px: number; py: number; ox: number; oy: number; moved: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!drag) return;
    const end = () => setDrag(null);
    window.addEventListener('blur', end);
    return () => window.removeEventListener('blur', end);
  }, [!!drag]);

  if (!l || hidden || route === '/today' || route.startsWith('/today/') || route === '') return null;
  // On the focus project's page the session panel shows the same; stay out of the way while it is on screen
  // (this re-renders every second, so it follows scrolling closely enough).
  if (!drag && route === `/p/${l.session.project_id}`) {
    const panel = document.querySelector('.session-panel')?.getBoundingClientRect();
    if (!panel || (panel.bottom > 0 && panel.top < window.innerHeight)) return null;
  }

  let main: string;
  let sub: string[] = [];
  const p = l.pomodoro;
  if (l.planned?.timeUp) main = 'Time is up';
  else if (p?.waiting) main = p.phase === 'work' ? 'Break time' : 'Back to work';
  else if (l.planned) main = `${clock(l.planned.left)} left`;
  else if (p) main = `${clock(p.left)} ${p.phase === 'work' ? 'work' : 'break'}`;
  else main = clock(l.worked);
  if (l.paused) sub.push('Paused');
  if (l.planned && p && !p.waiting && !l.planned.timeUp) sub.push(`${clock(p.left)} ${p.phase}`);
  if (l.planned || p) sub.push(`${clock(l.worked)} worked`);
  const alert = !!(l.planned?.timeUp || p?.waiting);

  const onDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const r = box.current!.getBoundingClientRect();
    start.current = { px: e.clientX, py: e.clientY, ox: r.left, oy: r.top, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.px;
    const dy = e.clientY - s.py;
    if (!s.moved && Math.hypot(dx, dy) < 6) return;
    s.moved = true;
    setDrag({ x: s.ox + dx, y: s.oy + dy });
  };
  const onUp = (e: PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    if (!s.moved) {
      go(`/p/${l.session.project_id}`);
      return;
    }
    const r = box.current!.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const c = `${cy < window.innerHeight / 2 ? 't' : 'b'}${cx < window.innerWidth / 2 ? 'l' : 'r'}` as Corner;
    setCorner(c);
    write('ft.timer.corner', c);
    setDrag(null);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  return (
    <div
      ref={box}
      class={`corner-timer ${drag ? 'dragging' : `at-${corner}`} ${alert ? 'alert' : ''} ${l.paused ? 'paused' : ''}`}
      style={drag ? { left: `${drag.x}px`, top: `${drag.y}px` } : undefined}
      role="button"
      tabIndex={0}
      aria-label={`Session on ${l.session.project_name ?? 'a project'}: ${main}. Open the project.`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => {
        start.current = null;
        setDrag(null);
      }}
      onKeyDown={(e) => e.key === 'Enter' && go(`/p/${l.session.project_id}`)}
    >
      <div class="ct-head">
        <span class="ct-name">{l.session.project_name}</span>
        <button class="icon small" aria-label="Hide the timer" title="Hide (Settings or the session panel shows it again)" onClick={() => setCornerHidden(true)}>
          ✕
        </button>
      </div>
      <div class="ct-main">{main}</div>
      {sub.length > 0 && <div class="ct-sub">{sub.join(' · ')}</div>}
    </div>
  );
}
