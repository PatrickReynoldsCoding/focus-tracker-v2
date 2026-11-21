// The Pomodoro timer, on its own: it does not belong to a work session. Work periods and breaks (a
// short break after each work period, a long break after every `rounds`th one) follow each other on
// the owner's click: when a period ends the timer alerts and waits for "Start break" / "Start work".
// The running timer is one JSON setting per mode ('pomodoro.current'), so every device shows the same.
//
// Setting 'pomodoro.breaks_pause_session' = 'on': a break also pauses the running session's clock, and
// the next work period resumes it (only when the break paused it, never a pause the owner made).

import { z } from 'zod';
import type { Ctx } from '../core/ctx';
import { bad } from '../core/errors';
import type { Module } from '../core/registry';
import { pauseSession, resumeSession, storedSession } from './sessions';

export type PomodoroPhase = 'work' | 'break' | 'long_break';

interface StoredPomodoro {
  phase: PomodoroPhase;
  /** When this period started (ms of pause time are taken off, see paused_ms). */
  started_at: string;
  paused_at?: string | null;
  paused_ms?: number;
  /** 1-based work round inside the cycle; the long break follows round `rounds`. */
  round: number;
  /** A break paused the session, so the next work period resumes it. */
  paused_session?: boolean;
}

export interface PomodoroConfig {
  work: number;
  break: number;
  long_break: number;
  rounds: number;
  breaks_pause_session: boolean;
}

const KEY = 'pomodoro.current';
const DEFAULT_WORK_MIN = 25;
const DEFAULT_BREAK_MIN = 5;
const DEFAULT_LONG_BREAK_MIN = 15;
const DEFAULT_ROUNDS = 4;

const wholeNumber = (raw: string | null, fallback: number) => {
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 1 ? n : fallback;
};

export async function pomodoroConfig(ctx: Ctx): Promise<PomodoroConfig> {
  return {
    work: wholeNumber(await ctx.setting('pomodoro.work'), DEFAULT_WORK_MIN),
    break: wholeNumber(await ctx.setting('pomodoro.break'), DEFAULT_BREAK_MIN),
    long_break: wholeNumber(await ctx.setting('pomodoro.long_break'), DEFAULT_LONG_BREAK_MIN),
    rounds: wholeNumber(await ctx.setting('pomodoro.rounds'), DEFAULT_ROUNDS),
    breaks_pause_session: (await ctx.setting('pomodoro.breaks_pause_session')) === 'on',
  };
}

const periodSeconds = (cfg: PomodoroConfig, phase: PomodoroPhase) => 60 * (phase === 'work' ? cfg.work : phase === 'break' ? cfg.break : cfg.long_break);

const elapsedSeconds = (s: StoredPomodoro, now: number) => {
  const paused = (s.paused_ms ?? 0) + (s.paused_at ? now - Date.parse(s.paused_at) : 0);
  return Math.max(0, Math.floor((now - Date.parse(s.started_at) - paused) / 1000));
};

const phaseAfter = (s: StoredPomodoro, cfg: PomodoroConfig): PomodoroPhase => (s.phase !== 'work' ? 'work' : s.round % cfg.rounds === 0 ? 'long_break' : 'break');
const roundAfter = (s: StoredPomodoro): number => (s.phase === 'long_break' ? 1 : s.phase === 'break' ? s.round + 1 : s.round);

/** The timer as clients see it. */
export function pomodoroView(s: StoredPomodoro, cfg: PomodoroConfig, now: number) {
  const total = periodSeconds(cfg, s.phase);
  const left = Math.max(0, total - elapsedSeconds(s, now));
  return {
    phase: s.phase,
    round: s.round,
    rounds: cfg.rounds,
    seconds_total: total,
    seconds_left: left,
    phase_ends_at: new Date(now + left * 1000).toISOString(),
    paused: !!s.paused_at,
    /** The period is over and waits for "Start break" / "Start work". */
    waiting: left === 0,
    next_phase: left === 0 ? phaseAfter(s, cfg) : null,
    started_at: s.started_at,
  };
}

const stored = (ctx: Ctx) => ctx.jsonSetting<StoredPomodoro | null>(KEY, null);
const save = (ctx: Ctx, s: StoredPomodoro | null) => ctx.setSetting(KEY, s ? JSON.stringify(s) : null);

/** The running timer, or null. */
export async function currentPomodoro(ctx: Ctx) {
  const s = await stored(ctx);
  return s ? pomodoroView(s, await pomodoroConfig(ctx), ctx.nowDate.getTime()) : null;
}

async function pauseSessionForBreak(ctx: Ctx): Promise<boolean> {
  const session = await storedSession(ctx);
  if (!session || session.paused_at) return false;
  await pauseSession(ctx);
  return true;
}

async function resumeSessionAfterBreak(ctx: Ctx) {
  const session = await storedSession(ctx);
  if (session?.paused_at) await resumeSession(ctx);
}

/** Start a fresh work period (round 1). Replaces a timer that is already running. */
export async function startPomodoro(ctx: Ctx) {
  const old = await stored(ctx);
  if (old?.paused_session) await resumeSessionAfterBreak(ctx);
  await save(ctx, { phase: 'work', started_at: ctx.now(), paused_ms: 0, round: 1 });
  return currentPomodoro(ctx);
}

/** "Start break" / "Start work": begin the next period now (also before this one ends). */
export async function nextPomodoroPeriod(ctx: Ctx) {
  const s = await stored(ctx);
  if (!s) throw bad('No pomodoro is running');
  const cfg = await pomodoroConfig(ctx);
  const phase = phaseAfter(s, cfg);
  let pausedSession = !!s.paused_session;
  if (phase === 'work' && pausedSession) {
    await resumeSessionAfterBreak(ctx);
    pausedSession = false;
  } else if (phase !== 'work' && cfg.breaks_pause_session) {
    pausedSession = (await pauseSessionForBreak(ctx)) || pausedSession;
  }
  await save(ctx, { phase, started_at: ctx.now(), paused_ms: 0, round: roundAfter(s), paused_session: pausedSession });
  return currentPomodoro(ctx);
}

export async function pausePomodoro(ctx: Ctx) {
  const s = await stored(ctx);
  if (!s) throw bad('No pomodoro is running');
  if (!s.paused_at) await save(ctx, { ...s, paused_at: ctx.now() });
  return currentPomodoro(ctx);
}

export async function resumePomodoro(ctx: Ctx) {
  const s = await stored(ctx);
  if (!s) throw bad('No pomodoro is running');
  if (s.paused_at) await save(ctx, { ...s, paused_at: null, paused_ms: (s.paused_ms ?? 0) + Math.max(0, ctx.nowDate.getTime() - Date.parse(s.paused_at)) });
  return currentPomodoro(ctx);
}

/** Stop the timer. A session a break paused is resumed. */
export async function stopPomodoro(ctx: Ctx) {
  const s = await stored(ctx);
  if (s?.paused_session) await resumeSessionAfterBreak(ctx);
  await save(ctx, null);
  return null;
}

/** The alert for a period that ended and waits for a click (made into a notification by the notifications module). */
export async function pomodoroNotices(ctx: Ctx) {
  const s = await stored(ctx);
  if (!s) return [];
  const cfg = await pomodoroConfig(ctx);
  const view = pomodoroView(s, cfg, ctx.nowDate.getTime());
  if (!view.waiting) return [];
  const endedAt = Date.parse(s.started_at) + (s.paused_ms ?? 0) + view.seconds_total * 1000;
  const title = s.phase !== 'work' ? 'Break over' : view.next_phase === 'long_break' ? 'Time for a long break' : 'Time for a break';
  const body = s.phase !== 'work' ? 'Start work when you are ready.' : `Work period ${s.round} of ${cfg.rounds} is over. Start the break when you are ready.`;
  return [{ kind: 'pomodoro' as const, title, body, due: new Date(Math.min(endedAt, ctx.nowDate.getTime())).toISOString(), dedupe_key: `pomodoro:${s.started_at}:${s.phase}-end` }];
}

export const pomodoroModule: Module = {
  id: 'pomodoro',
  description: 'A Pomodoro timer on its own (not tied to a session): work periods, short and long breaks, waits for a click between periods.',
  routes(api) {
    api.get('/pomodoro', async (c) => c.json({ pomodoro: await currentPomodoro(c.get('ctx')), config: await pomodoroConfig(c.get('ctx')) }));
    api.post('/pomodoro/start', async (c) => c.json({ pomodoro: await startPomodoro(c.get('ctx')) }));
    api.post('/pomodoro/next', async (c) => c.json({ pomodoro: await nextPomodoroPeriod(c.get('ctx')) }));
    api.post('/pomodoro/pause', async (c) => c.json({ pomodoro: await pausePomodoro(c.get('ctx')) }));
    api.post('/pomodoro/resume', async (c) => c.json({ pomodoro: await resumePomodoro(c.get('ctx')) }));
    api.post('/pomodoro/stop', async (c) => c.json({ pomodoro: await stopPomodoro(c.get('ctx')) }));
  },
  tools: [
    {
      name: 'start_pomodoro',
      description: 'Start the Pomodoro timer (a work period). It is separate from work sessions. A break or work period that ends waits for next_pomodoro.',
      input: z.object({}),
      run: (ctx) => startPomodoro(ctx),
    },
    {
      name: 'next_pomodoro',
      description: 'Start the next Pomodoro period now: the break after a work period (a long break after every few rounds), or work after a break.',
      input: z.object({}),
      run: (ctx) => nextPomodoroPeriod(ctx),
    },
    { name: 'pause_pomodoro', description: 'Pause the Pomodoro timer.', input: z.object({}), run: (ctx) => pausePomodoro(ctx) },
    { name: 'resume_pomodoro', description: 'Resume a paused Pomodoro timer.', input: z.object({}), run: (ctx) => resumePomodoro(ctx) },
    { name: 'stop_pomodoro', description: 'Stop the Pomodoro timer.', input: z.object({}), run: (ctx) => stopPomodoro(ctx) },
  ],
};
