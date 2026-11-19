// The running session in the browser: one shared copy of GET /api/session/state,
// a one-second clock, the actions (start, pause, resume, next period, keep going),
// and the alerts (sound once per period per device, blinking tab title while
// something waits for a click). The server holds the truth, so another device's
// clicks arrive with the next poll.

import { get, mode, optimistic, post, version } from '../../core/api';
import { flags } from '../../core/features';
import { signal, useSignal } from '../../core/signal';
import { isEink } from '../../core/theme';
import { play, type SoundName } from './sounds';

export type Phase = 'work' | 'break';
export type Pomodoro = {
  work: number;
  break: number;
  round: number;
  phase: Phase;
  seconds_left: number;
  waiting?: boolean;
  next_phase?: Phase | null;
};
export type Session = {
  project_id: string;
  project_name: string | null;
  started: string;
  elapsed_seconds: number;
  worked_seconds?: number;
  paused?: boolean;
  pomodoro: Pomodoro | null;
  planned?: { minutes: number; seconds_left: number; time_up: boolean } | null;
};
export type Defaults = { pomodoro: boolean; work: number; break: number; planned_min: number | null; lengths: number[] };
export type SessionState = { day: string; focus: { id: string; name: string } | null; session: Session | null; defaults: Defaults };

/** The last answer from the server and when it came (ms). */
export const state = signal<{ data: SessionState | null; at: number }>({ data: null, at: 0 });
/** Ticks every second while signed in. */
export const tick = signal(Date.now());

export async function refresh(): Promise<void> {
  try {
    state.value = { data: await get<SessionState>('/session/state'), at: Date.now() };
  } catch {
    /* offline or signed out: keep what we have */
  }
}

function setSession(session: Session | null) {
  const d = state.value.data;
  if (d) state.value = { data: { ...d, session }, at: Date.now() };
}

// ---------- the live view ----------

export type Live = {
  session: Session;
  worked: number;
  paused: boolean;
  pomodoro: (Pomodoro & { left: number; waiting: boolean }) | null;
  planned: { minutes: number; left: number; timeUp: boolean } | null;
  /** What waits for a click, if anything: the planned time wins over the pomodoro. */
  alert: null | { kind: 'time-up' | 'break' | 'work'; key: string; title: string };
};

export function live(session: Session | null | undefined, at: number, now: number): Live | null {
  if (!session) return null;
  const paused = !!session.paused;
  const delta = paused ? 0 : Math.max(0, Math.floor((now - at) / 1000));
  const worked = (session.worked_seconds ?? session.elapsed_seconds) + delta;
  const waits = flags.value['pomodoro-waits-for-click'] !== false;
  let pomodoro: Live['pomodoro'] = null;
  if (session.pomodoro) {
    const left = Math.max(0, session.pomodoro.seconds_left - delta);
    const waiting = !!session.pomodoro.waiting || (waits && left === 0);
    pomodoro = { ...session.pomodoro, left, waiting, next_phase: waiting ? (session.pomodoro.phase === 'work' ? 'break' : 'work') : null };
  }
  const planned = session.planned ? { minutes: session.planned.minutes, left: Math.max(0, session.planned.seconds_left - delta), timeUp: session.planned.time_up || session.planned.seconds_left - delta <= 0 } : null;
  let alert: Live['alert'] = null;
  if (planned?.timeUp) alert = { kind: 'time-up', key: `${session.started}:up:${planned.minutes}`, title: '⏰ Time is up' };
  else if (pomodoro?.waiting)
    alert =
      pomodoro.phase === 'work'
        ? { kind: 'break', key: `${session.started}:${pomodoro.round}:work`, title: '☕ Break time' }
        : { kind: 'work', key: `${session.started}:${pomodoro.round}:break`, title: '⏰ Back to work' };
  return { session, worked, paused, pomodoro, planned, alert };
}

/** The session state, re-rendered every second. */
export function useSession(): { data: SessionState | null; live: Live | null } {
  const s = useSignal(state);
  const now = useSignal(tick);
  useSignal(flags);
  return { data: s.data, live: live(s.data?.session, s.at, now) };
}

/** Whole minutes, for E-ink (it redraws once a minute): 25 min, 1 h 05. */
export const clockMinutes = (sec: number) => {
  const m = Math.floor(Math.max(0, sec) / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;
};

export const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

// ---------- actions ----------

/** Change the session on screen at once, send it, and take the server's answer. */
function act(path: string, body: unknown, local: (s: Session) => Session, done?: string) {
  const before = state.value;
  return optimistic(
    () => {
      const s = before.data?.session;
      if (s) setSession(local(s));
      return () => (state.value = before);
    },
    async () => {
      const out = await post<Session | null>(path, body);
      setSession(out);
      return out;
    },
    done,
  );
}

const now = () => live(state.value.data?.session, state.value.at, Date.now());

export const pause = () => {
  const l = now();
  return act('/session/pause', {}, (s) => ({
    ...s,
    paused: true,
    worked_seconds: l?.worked ?? s.worked_seconds,
    elapsed_seconds: l?.worked ?? s.elapsed_seconds,
    pomodoro: s.pomodoro && { ...s.pomodoro, seconds_left: l?.pomodoro?.left ?? s.pomodoro.seconds_left },
    planned: s.planned && { ...s.planned, seconds_left: l?.planned?.left ?? s.planned.seconds_left },
  }));
};
export const resume = () => act('/session/resume', {}, (s) => ({ ...s, paused: false }));
export const nextPeriod = () =>
  act('/session/next', {}, (s) => {
    if (!s.pomodoro) return s;
    const phase: Phase = s.pomodoro.phase === 'work' ? 'break' : 'work';
    return {
      ...s,
      paused: false,
      pomodoro: { ...s.pomodoro, phase, waiting: false, next_phase: null, round: s.pomodoro.round + (phase === 'work' ? 1 : 0), seconds_left: (phase === 'work' ? s.pomodoro.work : s.pomodoro.break) * 60 },
    };
  });
export const keepGoing = (minutes: number | null) =>
  act('/session/extend', { minutes }, (s) => {
    if (minutes === null) return { ...s, planned: null };
    const left = Math.max(0, now()?.planned?.left ?? 0) + minutes * 60;
    return { ...s, planned: { minutes: (s.planned?.minutes ?? 0) + minutes, seconds_left: left, time_up: false } };
  });
export const setPomodoro = (on: boolean) => act('/session/pomodoro', { on }, (s) => s);

export async function start(opts: { planned_min: number | null; pomodoro: boolean }) {
  const out = await optimistic(
    () => () => {},
    () => post<Session>('/session/start', opts),
    'Session started',
  );
  if (out) setSession(out);
  return out;
}

// ---------- background: polling, the clock, alerts ----------

let running = false;
/** Keys already alerted on this device (sound once per period). */
const alerted = new Set<string>(readAlerted());
let lastAlert: string | null = null;
let baseTitle = typeof document !== 'undefined' ? document.title : '';

function readAlerted(): string[] {
  try {
    return JSON.parse(localStorage.getItem('ft.alerted') ?? '[]');
  } catch {
    return [];
  }
}
function remember(key: string) {
  alerted.add(key);
  try {
    localStorage.setItem('ft.alerted', JSON.stringify([...alerted].slice(-30)));
  } catch {
    /* private mode */
  }
}

/** Start polling and the clock once (the runtime overlay calls this). */
export function startRuntime(): () => void {
  if (running) return () => {};
  running = true;
  void refresh();
  let lastPoll = Date.now();
  let prev: Live | null = null;
  let lastPaint = 0;
  const timer = setInterval(() => {
    const t = Date.now();
    // E-ink: the clock redraws once a minute (every second would flash the screen); the loop itself stays cheap.
    if (!isEink() || t - lastPaint >= 60_000) {
      lastPaint = t;
      tick.value = t;
    }
    const visible = document.visibilityState === 'visible';
    if (t - lastPoll > (visible ? 30_000 : 120_000)) {
      lastPoll = t;
      void refresh();
    }
    const l = live(state.value.data?.session, state.value.at, t);
    // A countdown reached zero here: ask the server for the real state (and play the sound now).
    const crossed = !!l?.alert && !prev?.alert;
    if (crossed && l && !alerted.has(l.alert!.key)) {
      remember(l.alert!.key);
      const sound: SoundName = l.alert!.kind === 'work' ? 'break-ends' : 'work-ends';
      if (prev) play(sound); // only when it happened while the page was open, not on opening hours later
      lastPaint = t;
      tick.value = t; // an alert always shows at once, even in E-ink
      setTimeout(() => void refresh(), 1500);
    }
    if (l && !l.paused && l.pomodoro && !l.pomodoro.waiting && l.pomodoro.left === 0) void refresh(); // cycling model moved on
    prev = l;
    blink(l, t);
  }, 1000);
  const unsubVersion = version.subscribe(() => void refresh());
  const unsubMode = mode.subscribe(() => void refresh());
  const vis = () => document.visibilityState === 'visible' && void refresh();
  document.addEventListener('visibilitychange', vis);
  return () => {
    running = false;
    clearInterval(timer);
    unsubVersion();
    unsubMode();
    document.removeEventListener('visibilitychange', vis);
  };
}

/** The tab title blinks while something waits for a click. */
function blink(l: Live | null, t: number) {
  const a = l?.alert;
  if (!a) {
    if (lastAlert !== null) document.title = baseTitle;
    lastAlert = null;
    baseTitle = document.title;
    return;
  }
  lastAlert = a.key;
  document.title = Math.floor(t / 1000) % 2 ? a.title : baseTitle;
}
