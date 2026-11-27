// A small timer in a corner of every page while a session runs (not on Today,
// where the focus card shows it). Drag it anywhere with a mouse, or hold and
// drag with a finger (core/draggable); tap it to open the focus project; ✕
// hides it. Its place and hidden state are kept on this device.

import { useDraggable } from '../../core/draggable';
import { signal, useSignal } from '../../core/signal';
import { go } from '../../core/ui';
import { useEink } from '../../core/theme';
import { clock as clockSeconds, clockMinutes, useSession } from './session';

type Corner = 'tl' | 'tr' | 'bl' | 'br';

function read(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function remove(k: string) {
  try {
    localStorage.removeItem(k);
  } catch {
    /* private mode */
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
  const clock = useEink() ? clockMinutes : clockSeconds; // E-ink redraws once a minute, so no seconds
  const hidden = useCornerHidden();
  const corner = (() => {
    const c = read('ft.timer.corner'); // the older snap-to-corner choice, used until it is dragged again
    return c === 'tl' || c === 'tr' || c === 'bl' || c === 'br' ? c : 'bl';
  })() as Corner;
  const { ref: box, onPointerDown, gripProps, moving } = useDraggable<HTMLDivElement>('ft.timer.place', () => remove('ft.timer.corner'));

  if (!l || hidden || route === '/today' || route.startsWith('/today/') || route === '') return null;
  // On the focus project's page the session panel shows the same; stay out of the way while it is on screen
  // (this re-renders every second, so it follows scrolling closely enough).
  if (!moving && route === `/p/${l.session.project_id}`) {
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

  return (
    <div
      ref={box}
      class={`corner-timer drag-float at-${corner} ${moving ? 'dragging' : ''} ${alert ? 'alert' : ''} ${l.paused ? 'paused' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`Session on ${l.session.project_name ?? 'a project'}: ${main}. Open the project.`}
      onPointerDown={(e) => onPointerDown(e as unknown as PointerEvent)}
      onClick={(e) => !(e.target as HTMLElement).closest('button, .drag-grip') && go(`/p/${l.session.project_id}`)}
      onKeyDown={(e) => e.key === 'Enter' && go(`/p/${l.session.project_id}`)}
    >
      <div class="ct-head">
        <span {...gripProps}>⠿</span>
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
