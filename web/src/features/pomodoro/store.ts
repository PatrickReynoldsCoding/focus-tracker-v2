// The Pomodoro in the browser: one shared copy of GET /api/pomodoro, a one-second clock, the actions,
// and the alert sound (once per finished period per device). The server holds the truth, so another
// device's clicks arrive with the next poll. It is separate from work sessions.

import { get, post } from '../../core/api';
import { signal, useSignal } from '../../core/signal';
import { play } from '../today/sounds';

export type PomodoroPhase = 'work' | 'break' | 'long_break';
export type Pomodoro = {
  phase: PomodoroPhase;
  round: number;
  rounds: number;
  seconds_total: number;
  seconds_left: number;
  paused: boolean;
  waiting: boolean;
  next_phase: PomodoroPhase | null;
  started_at: string;
};
export type PomodoroConfig = { work: number; break: number; long_break: number; rounds: number; breaks_pause_session: boolean };

const POLL_MS = 15_000;

const state = signal<{ pomodoro: Pomodoro | null; config: PomodoroConfig | null; at: number }>({ pomodoro: null, config: null, at: 0 });
const tick = signal(Date.now());

export async function refreshPomodoro(): Promise<void> {
  try {
    const r = await get<{ pomodoro: Pomodoro | null; config: PomodoroConfig }>('/pomodoro');
    state.value = { pomodoro: r.pomodoro, config: r.config, at: Date.now() };
  } catch {
    /* offline or signed out: keep what we have */
  }
}

async function act(path: string) {
  const r = await post<{ pomodoro: Pomodoro | null }>(`/pomodoro/${path}`);
  state.value = { ...state.value, pomodoro: r.pomodoro, at: Date.now() };
}
export const startPomodoro = () => act('start');
export const nextPomodoro = () => act('next');
export const pausePomodoro = () => act('pause');
export const resumePomodoro = () => act('resume');
export const stopPomodoro = () => act('stop');

export type LivePomodoro = Pomodoro & { left: number };

export function usePomodoro(): { pomodoro: LivePomodoro | null; config: PomodoroConfig | null } {
  const s = useSignal(state);
  const now = useSignal(tick);
  const p = s.pomodoro;
  if (!p) return { pomodoro: null, config: s.config };
  const delta = p.paused || p.waiting ? 0 : Math.max(0, Math.floor((now - s.at) / 1000));
  const left = Math.max(0, p.seconds_left - delta);
  return { pomodoro: { ...p, left, waiting: p.waiting || left === 0 }, config: s.config };
}

export const phaseLabel = (p: { phase: PomodoroPhase }) => (p.phase === 'work' ? 'Work' : p.phase === 'break' ? 'Break' : 'Long break');
export const nextLabel = (p: { next_phase: PomodoroPhase | null }) => (p.next_phase === 'work' ? 'Start work' : p.next_phase === 'long_break' ? 'Start long break' : 'Start break');
export const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

let alerted = '';
function alertOnce(p: LivePomodoro | null) {
  if (!p?.waiting) return;
  const key = `${p.started_at}:${p.phase}`;
  if (key === alerted) return;
  alerted = key;
  play(p.phase === 'work' ? 'work-ends' : 'break-ends');
}

let started = false;
/** Poll the server and tick the clock. Call once; safe to call again. */
export function startPomodoroClock() {
  if (started) return;
  started = true;
  void refreshPomodoro();
  setInterval(() => {
    tick.value = Date.now();
    const s = state.value;
    if (s.pomodoro && !s.pomodoro.paused && !s.pomodoro.waiting && Date.now() - s.at >= s.pomodoro.seconds_left * 1000) {
      // The period just ended here: ask the server what comes next (it may have been started on another device).
      void refreshPomodoro().then(() => alertOnce(currentLive()));
    }
  }, 1000);
  setInterval(() => document.visibilityState === 'visible' && void refreshPomodoro().then(() => alertOnce(currentLive())), POLL_MS);
}

function currentLive(): LivePomodoro | null {
  const s = state.value;
  const p = s.pomodoro;
  if (!p) return null;
  const delta = p.paused || p.waiting ? 0 : Math.max(0, Math.floor((Date.now() - s.at) / 1000));
  const left = Math.max(0, p.seconds_left - delta);
  return { ...p, left, waiting: p.waiting || left === 0 };
}
