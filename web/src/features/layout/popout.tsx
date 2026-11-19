// Pop-out windows (V1-GAPS 41, flag `popout-windows`; from 760 px, never on a phone): any panel of
// a page that registered a place (Today, a project's page) can be popped out into a window that
// stays on screen on every tab: a free window (drag by its title, resize from its corner, minimise
// to a chip in the dock at the bottom) or docked in a pane on the right. Its page shows a
// placeholder meanwhile, as does any other panel editing the same note (oneCopy), so a note is
// never in two editors at once. Kept per device and mode in localStorage (`ft.popout.<mode>`).

import type { VNode } from 'preact';
import { useEffect, useLayoutEffect, useReducer, useRef } from 'preact/hooks';
import { mode } from '../../core/api';
import { useFlags } from '../../core/features';
import { lookupPanel, placeDef, type PanelDef, type PanelLayoutProps, type PlaceDef } from '../../core/registry';
import { signal, useSignal } from '../../core/signal';
import { Loading } from '../../core/ui';
import { titleOf, useMedia, WINDOWS } from './store';

export type Win = {
  uid: string;
  place: string;
  /** The page's key: a project's id, '' for Today. */
  key: string;
  panel: string;
  title: string;
  /** The panel's oneCopy key when it was popped out. */
  one: string | null;
  style: 'float' | 'pane';
  x: number;
  y: number;
  w: number;
  h: number;
  min: boolean;
  z: number;
};
type State = { wins: Win[]; paneW: number; tab: string | null };

const MIN_W = 260;
const MIN_H = 160;
const storeKey = (m: string) => `ft.popout.${m}`;
const empty = (): State => ({ wins: [], paneW: 380, tab: null });

function read(m: string): State {
  try {
    const s = JSON.parse(localStorage.getItem(storeKey(m)) ?? 'null') as State | null;
    return s && Array.isArray(s.wins) ? { ...empty(), ...s } : empty();
  } catch {
    return empty();
  }
}

export const popState = signal<State>(read(mode.value));
mode.subscribe((m) => (popState.value = read(m)));

function write(next: State) {
  popState.value = next;
  try {
    localStorage.setItem(storeKey(mode.value), JSON.stringify(next));
  } catch {
    /* private mode: kept until the page closes */
  }
}
const update = (uid: string, change: Partial<Win>) => write({ ...popState.value, wins: popState.value.wins.map((w) => (w.uid === uid ? { ...w, ...change } : w)) });
const topZ = () => Math.max(10, ...popState.value.wins.map((w) => w.z)) + 1;
export const raise = (uid: string) => {
  const w = popState.value.wins.find((x) => x.uid === uid);
  if (!w) return;
  if (w.style === 'pane') return write({ ...popState.value, tab: uid, wins: popState.value.wins.map((x) => (x.uid === uid ? { ...x, min: false } : x)) });
  update(uid, { min: false, z: topZ() });
};
export const putBack = (uid: string) => {
  const s = popState.value;
  write({ ...s, wins: s.wins.filter((w) => w.uid !== uid), tab: s.tab === uid ? null : s.tab });
};

function popOut(place: string, key: string, p: PanelDef<any>, props: any) {
  const def = placeDef(place);
  const where = def && place !== 'today' ? def.label(props) : '';
  const n = popState.value.wins.filter((w) => w.style === 'float').length;
  const w = Math.min(460, innerWidth - 40);
  const h = Math.min(520, innerHeight - 140);
  const win: Win = {
    uid: `${place}.${key}.${p.id}.${Date.now().toString(36)}`,
    place,
    key,
    panel: p.id,
    title: where ? `${titleOf(p)} · ${where}` : titleOf(p),
    one: p.oneCopy?.(props) ?? null,
    style: 'float',
    x: Math.max(8, innerWidth - w - 32 - (n % 5) * 28),
    y: 80 + (n % 5) * 28,
    w,
    h,
    min: false,
    z: topZ(),
  };
  write({ ...popState.value, wins: [...popState.value.wins, win] });
}

/** The window a panel of a page is in (itself, or another panel editing the same note). */
function windowFor(wins: Win[], place: string, key: string, p: PanelDef<any>, props: any): Win | undefined {
  const one = p.oneCopy?.(props) ?? null;
  return wins.find((w) => (w.place === place && w.key === key && w.panel === p.id) || (one && w.one === one));
}

/** The layout step: on a wide screen every panel gets a Pop out button, and one that is in a window
 *  (or edits a note that is) becomes a placeholder, so the page keeps its place. */
export function PopoutLayout({ place, props, panels, next }: PanelLayoutProps) {
  const wide = useMedia(WINDOWS);
  const { wins } = useSignal(popState);
  const def = placeDef(place);
  if (!wide || !def) return next(panels);
  const key = def.keyOf(props);
  return next(
    panels.map((p) => {
      if (p.fixed) return p;
      const w = windowFor(wins, place, key, p, props);
      if (w)
        return {
          ...p,
          render: () => <Placeholder win={w} same={w.place === place && w.key === key && w.panel === p.id} />,
        };
      return {
        ...p,
        // In the desktop grid the button is in the panel's ⋯ menu instead.
        menu: (pr: any) => [...(p.menu?.(pr) ?? []), { label: 'Pop out', icon: '⧉', run: () => popOut(place, key, p, pr) }],
        render: (pr: any) => {
          const node = p.render(pr);
          if (!node) return null;
          return (
            <div class={`po-slot ${p.wide ? 'wide' : ''}`}>
              {node}
              <button class="po-btn" aria-label={`Pop out ${titleOf(p)}`} title="Pop out into a window" onClick={() => popOut(place, key, p, pr)}>
                ⧉
              </button>
            </div>
          );
        },
      };
    }),
  );
}

function Placeholder({ win, same }: { win: Win; same: boolean }) {
  return (
    <section class="card po-placeholder">
      <p>
        <strong>{same ? titleOf({ id: win.panel, title: win.title.split(' · ')[0] }) : win.title}</strong> {same ? 'is in a window.' : 'is open in a window, so it is not shown here too.'}
      </p>
      <div class="row">
        <button class="small" onClick={() => raise(win.uid)}>
          Show window
        </button>
        <button class="small ghost" onClick={() => putBack(win.uid)}>
          {same ? 'Put back here' : 'Close window'}
        </button>
      </div>
    </section>
  );
}

// ---------- the windows, the pane and the dock (an overlay on every page) ----------

/** The panel itself, with the props its page would give it (loaded here). */
function WinBody({ win }: { win: Win }) {
  const def = placeDef(win.place);
  if (!def) return <p class="muted">This page’s panels cannot be shown in a window any more.</p>;
  return <WinProps def={def} win={win} />;
}
function WinProps({ def, win }: { def: PlaceDef; win: Win }) {
  const flags = useFlags();
  const { props, error } = def.useProps(win.key);
  if (!props) return error ? <Gone text={error} win={win} /> : <Loading />;
  const p = lookupPanel(win.place, win.panel, flags);
  if (!p) return <Gone text="This panel is not there any more (its feature may be off)." win={win} />;
  const node = p.render(props) as VNode | null;
  return node ?? <p class="muted">Nothing to show here right now.</p>;
}
function Gone({ text, win }: { text: string; win: Win }) {
  return (
    <div class="po-gone">
      <p class="muted">{text}</p>
      <button class="small" onClick={() => putBack(win.uid)}>
        Close window
      </button>
    </div>
  );
}

type Grab = { uid: string; kind: 'move' | 'size'; sx: number; sy: number; x: number; y: number; w: number; h: number; el: HTMLElement; pointer: number };

const clampWin = (w: Win): Win => {
  const ww = Math.max(MIN_W, Math.min(w.w, innerWidth - 16));
  const hh = Math.max(MIN_H, Math.min(w.h, innerHeight - 16));
  return { ...w, w: ww, h: hh, x: Math.max(0, Math.min(w.x, innerWidth - 120)), y: Math.max(0, Math.min(w.y, innerHeight - 48)) };
};

export function PopoutWindows() {
  const wide = useMedia(WINDOWS);
  const s = useSignal(popState);
  const grab = useRef<Grab | null>(null);
  // Re-draw when the window is resized, so every window stays reachable.
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const on = () => force(undefined as never);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  const pane = s.wins.filter((w) => w.style === 'pane');
  const floats = s.wins.filter((w) => w.style === 'float' && !w.min);
  const docked = s.wins.filter((w) => w.min);
  const paneOpen = wide && pane.some((w) => !w.min);
  const tab = pane.find((w) => w.uid === s.tab && !w.min) ?? pane.find((w) => !w.min);
  const paneW = Math.max(280, Math.min(s.paneW, Math.round(innerWidth * 0.6)));

  // The page makes room for the pane.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('po-docked', paneOpen);
    root.style.setProperty('--po-pane', `${paneW}px`);
    return () => root.classList.remove('po-docked');
  }, [paneOpen, paneW]);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const g = grab.current;
      if (!g || e.pointerId !== g.pointer) return;
      e.preventDefault();
      const dx = e.clientX - g.sx;
      const dy = e.clientY - g.sy;
      if (g.kind === 'move') {
        g.el.style.left = `${Math.max(0, Math.min(innerWidth - 120, g.x + dx))}px`;
        g.el.style.top = `${Math.max(0, Math.min(innerHeight - 48, g.y + dy))}px`;
      } else if (g.uid === 'pane') {
        g.el.style.width = `${Math.max(280, Math.min(innerWidth * 0.6, g.w - dx))}px`;
        document.documentElement.style.setProperty('--po-pane', g.el.style.width);
      } else {
        g.el.style.width = `${Math.max(MIN_W, Math.min(innerWidth - g.x - 4, g.w + dx))}px`;
        g.el.style.height = `${Math.max(MIN_H, Math.min(innerHeight - g.y - 4, g.h + dy))}px`;
      }
    };
    const up = (e: PointerEvent) => {
      const g = grab.current;
      if (!g || e.pointerId !== g.pointer) return;
      grab.current = null;
      document.body.classList.remove('po-grabbing');
      const r = g.el.getBoundingClientRect();
      if (g.uid === 'pane') write({ ...popState.value, paneW: Math.round(r.width) });
      else update(g.uid, g.kind === 'move' ? { x: Math.round(r.left), y: Math.round(r.top) } : { w: Math.round(r.width), h: Math.round(r.height) });
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  if (!wide) return null; // no windows on a phone: they come back when the screen is wide again

  const start = (e: PointerEvent, uid: string, kind: Grab['kind'], el: HTMLElement | null) => {
    if (!el || e.button !== 0 || (kind === 'move' && (e.target as HTMLElement).closest('button'))) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    grab.current = { uid, kind, sx: e.clientX, sy: e.clientY, x: r.left, y: r.top, w: r.width, h: r.height, el, pointer: e.pointerId };
    document.body.classList.add('po-grabbing');
    if (uid !== 'pane') raise(uid);
  };
  const keyOnWin = (e: KeyboardEvent, w: Win) => {
    if (e.key === 'Escape' && !document.querySelector('dialog[open]')) {
      e.stopPropagation();
      update(w.uid, { min: true });
    }
  };
  const tools = (w: Win) => (
    <span class="po-tools">
      {w.style === 'float' ? (
        <button class="icon small" aria-label={`Dock ${w.title} on the right`} title="Dock on the right" onClick={() => write({ ...popState.value, tab: w.uid, wins: popState.value.wins.map((x) => (x.uid === w.uid ? { ...x, style: 'pane', min: false } : x)) })}>
          ⇥
        </button>
      ) : (
        <button class="icon small" aria-label={`Float ${w.title} as a window`} title="Float as a window" onClick={() => update(w.uid, { style: 'float', min: false, z: topZ() })}>
          ⧉
        </button>
      )}
      <button class="icon small" aria-label={`Minimise ${w.title}`} title="Minimise" onClick={() => update(w.uid, { min: true })}>
        –
      </button>
      <button class="icon small" aria-label={`Put ${w.title} back on its page`} title="Put back on its page" onClick={() => putBack(w.uid)}>
        ✕
      </button>
    </span>
  );

  return (
    <>
      {floats.map((w0) => {
        const w = clampWin(w0);
        return (
          <section
            key={w.uid}
            class="po-win"
            role="dialog"
            aria-label={w.title}
            data-win={w.uid}
            style={{ left: `${w.x}px`, top: `${w.y}px`, width: `${w.w}px`, height: `${w.h}px`, zIndex: w.z }}
            onPointerDown={() => w.z < topZ() - 1 && raise(w.uid)}
            onKeyDown={(e) => keyOnWin(e as unknown as KeyboardEvent, w)}
          >
            <header class="po-head" onPointerDown={(e) => start(e as unknown as PointerEvent, w.uid, 'move', (e.currentTarget as HTMLElement).parentElement)}>
              <span class="po-title">{w.title}</span>
              {tools(w)}
            </header>
            <div class="po-body" data-no-swipe>
              <WinBody win={w} />
            </div>
            <span class="po-size" aria-hidden="true" onPointerDown={(e) => start(e as unknown as PointerEvent, w.uid, 'size', (e.currentTarget as HTMLElement).parentElement)} />
          </section>
        );
      })}
      {paneOpen && tab && (
        <aside class="po-pane" aria-label="Docked panels" style={{ width: `${paneW}px` }} onKeyDown={(e) => keyOnWin(e as unknown as KeyboardEvent, tab)}>
          <div
            class="po-divider"
            role="separator"
            aria-orientation="vertical"
            aria-label="Pane width"
            aria-valuenow={paneW}
            tabIndex={0}
            onPointerDown={(e) => start(e as unknown as PointerEvent, 'pane', 'size', (e.currentTarget as HTMLElement).parentElement)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                write({ ...popState.value, paneW: paneW + (e.key === 'ArrowLeft' ? 20 : -20) });
              }
            }}
          />
          {pane.filter((w) => !w.min).length > 1 && (
            <div class="po-tabs" role="tablist">
              {pane
                .filter((w) => !w.min)
                .map((w) => (
                  <button key={w.uid} role="tab" aria-selected={w.uid === tab.uid} class={w.uid === tab.uid ? 'on' : ''} onClick={() => write({ ...popState.value, tab: w.uid })}>
                    {w.title}
                  </button>
                ))}
            </div>
          )}
          <header class="po-head">
            <span class="po-title">{tab.title}</span>
            {tools(tab)}
          </header>
          <div class="po-body" data-no-swipe key={tab.uid}>
            <WinBody win={tab} />
          </div>
        </aside>
      )}
      {docked.length > 0 && (
        <nav class="po-dock" aria-label="Minimised windows">
          {docked.map((w) => (
            <button key={w.uid} class="po-chip" onClick={() => raise(w.uid)} title="Show this window">
              ⧉ {w.title}
            </button>
          ))}
        </nav>
      )}
    </>
  );
}
