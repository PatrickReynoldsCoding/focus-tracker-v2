// Work sessions: start, pause and resume, a pomodoro that waits for a click
// between periods, a planned length with "Time is up", and finishing with a
// shutdown note. The running session is one JSON setting per mode
// ('session.current'), so it survives switching devices.
//
// Time worked never counts paused time. The pomodoro and the planned length
// both run on time worked, so a pause stops them too. Breaks count as time
// worked (as in v1): only Pause stops the clock.

import { z } from 'zod';
import type { Ctx } from '../core/ctx';
import { bad } from '../core/errors';
import type { Module } from '../core/registry';
import { create, find, get, update } from '../core/store';
import { projectsEntity } from './projects';
import { logEntity } from './today';

export type Phase = 'work' | 'break';

/** What is stored in the 'session.current' setting. Sessions saved before pauses existed have only the first three fields. */
export interface StoredSession {
  project_id: string | null;
  started: string;
  pomodoro: { work: number; break: number } | null;
  /** Set while paused. */
  paused_at?: string | null;
  /** Paused time before the current pause, in ms. */
  paused_ms?: number;
  /** Seconds worked after which the planned time is up; null or missing = no limit. */
  planned_sec?: number | null;
  /** The pomodoro period now running (waits-for-click model). */
  phase?: Phase;
  /** Seconds worked when that period started. */
  phase_start?: number;
  round?: number;
}

export const LENGTHS = [25, 50, 90];
const MAX_MIN = 600;
const KEY = 'session.current';
/** The planned length used last, per profile (D35; it was global like v1 until v0.30.0). 'none' = no limit. */
const LENGTH_KEY = 'session.length';

export const workedSeconds = (s: StoredSession, now: number) => {
  const paused = (s.paused_ms ?? 0) + (s.paused_at ? now - Date.parse(s.paused_at) : 0);
  return Math.max(0, Math.floor((now - Date.parse(s.started) - paused) / 1000));
};

/** The pomodoro as clients see it. `phase` and `seconds_left` keep their old meaning; the rest is new. */
export function pomodoroView(s: StoredSession, worked: number, now: number, waits: boolean) {
  if (!s.pomodoro) return null;
  const work = s.pomodoro.work * 60;
  const brk = s.pomodoro.break * 60;
  let phase: Phase, round: number, left: number, phaseStart: number;
  if (waits) {
    phase = s.phase ?? 'work';
    round = s.round ?? 1;
    phaseStart = s.phase_start ?? 0;
    left = Math.max(0, phaseStart + (phase === 'work' ? work : brk) - worked);
  } else {
    // The old model: work and break follow each other by themselves.
    const cycle = work + brk;
    const inCycle = worked % cycle;
    round = Math.floor(worked / cycle) + 1;
    phase = inCycle < work ? 'work' : 'break';
    left = phase === 'work' ? work - inCycle : cycle - inCycle;
    phaseStart = worked - (phase === 'work' ? inCycle : inCycle - work);
  }
  const waiting = waits && left === 0;
  return {
    work: s.pomodoro.work,
    break: s.pomodoro.break,
    round,
    phase,
    seconds_left: left,
    phase_ends_at: new Date(now + left * 1000).toISOString(),
    /** The period is over and waits for "Start break" / "Start work". */
    waiting,
    next_phase: waiting ? ((phase === 'work' ? 'break' : 'work') as Phase) : null,
    /** Seconds worked when this period started (for notices). */
    phase_started_at_worked: phaseStart,
    paused: !!s.paused_at,
  };
}

export function plannedView(s: StoredSession, worked: number) {
  if (s.planned_sec == null) return null;
  return {
    minutes: Math.round(s.planned_sec / 60),
    seconds_left: Math.max(0, s.planned_sec - worked),
    time_up: worked >= s.planned_sec,
  };
}

async function stored(ctx: Ctx): Promise<StoredSession | null> {
  return ctx.jsonSetting<StoredSession | null>(KEY, null);
}

async function save(ctx: Ctx, s: StoredSession | null) {
  await ctx.setSetting(KEY, s ? JSON.stringify(s) : null);
}

async function mustHave(ctx: Ctx): Promise<StoredSession> {
  const s = await stored(ctx);
  if (!s) throw bad('No session is running');
  return s;
}

export const waitsForClick = (ctx: Ctx) => ctx.feature('pomodoro-waits-for-click');

/** The running session as clients see it, or null. */
export async function currentSession(ctx: Ctx) {
  const s = await stored(ctx);
  if (!s) return null;
  const now = ctx.nowDate.getTime();
  const worked = workedSeconds(s, now);
  const project = s.project_id ? await find(ctx, projectsEntity, s.project_id) : null;
  return {
    project_id: s.project_id,
    project_name: project?.name ?? null,
    started: s.started,
    /** Seconds worked, without paused time (the same as worked_seconds; kept for older clients). */
    elapsed_seconds: worked,
    worked_seconds: worked,
    paused: !!s.paused_at,
    paused_at: s.paused_at ?? null,
    pomodoro: pomodoroView(s, worked, now, await waitsForClick(ctx)),
    planned: plannedView(s, worked),
    now: ctx.now(),
  };
}

/** The planned length used last, in minutes (null = no limit). 25 before anything was chosen. */
export async function lastLength(ctx: Ctx): Promise<number | null> {
  const v = await ctx.setting(LENGTH_KEY);
  if (v === 'none') return null;
  const n = Number(v);
  return v && Number.isInteger(n) && n >= 1 && n <= MAX_MIN ? n : 25;
}

/** A planned length sent for the setting: minutes, or null / "none" for no limit (stored as 'none'). */
function parseLength(v: unknown): string {
  if (v === 'none') return 'none';
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_MIN) throw bad(`The planned length must be whole minutes from 1 to ${MAX_MIN}, or "none" for no limit`);
  return String(n);
}

function checkMinutes(v: unknown, field: string): number | null {
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > MAX_MIN) throw bad(`${field} must be whole minutes from 1 to ${MAX_MIN}, or null for no limit`);
  return v;
}

/** What a new session would use: for the start controls in clients. */
export async function sessionDefaults(ctx: Ctx) {
  return {
    // The Pomodoro is its own timer now (pomodoro.ts). A session only has the old one if asked for it.
    pomodoro: (await ctx.setting('pomodoro.default')) === 'on',
    work: Number((await ctx.setting('pomodoro.work')) ?? 25),
    break: Number((await ctx.setting('pomodoro.break')) ?? 5),
    planned_min: await lastLength(ctx),
    lengths: LENGTHS,
  };
}

export async function startSession(
  ctx: Ctx,
  input: { project_id?: string; pomodoro?: boolean; work?: number; break?: number; planned_min?: number | null },
) {
  if (await stored(ctx)) throw bad('A session is already running. Stop it first.');
  const day = await ctx.today();
  const projectId = input.project_id ?? (await ctx.setting(`focus.${day}`));
  if (!projectId) throw bad('No project given and no focus project chosen for today');
  await get(ctx, projectsEntity, projectId);
  const d = await sessionDefaults(ctx);
  let planned: number | null;
  if (input.planned_min !== undefined) {
    planned = checkMinutes(input.planned_min, 'planned_min');
    await ctx.setSetting(LENGTH_KEY, planned === null ? 'none' : String(planned));
  } else planned = d.planned_min;
  const usePomodoro = input.pomodoro ?? d.pomodoro;
  const s: StoredSession = {
    project_id: projectId,
    started: ctx.now(),
    pomodoro: usePomodoro ? { work: input.work ?? d.work, break: input.break ?? d.break } : null,
    paused_at: null,
    paused_ms: 0,
    planned_sec: planned === null ? null : planned * 60,
    phase: 'work',
    phase_start: 0,
    round: 1,
  };
  await save(ctx, s);
  return currentSession(ctx);
}

/** Pause the clock (time worked, the pomodoro and the planned time). Pausing twice is harmless. */
export async function pauseSession(ctx: Ctx) {
  const s = await mustHave(ctx);
  if (!s.paused_at) await save(ctx, { ...s, paused_at: ctx.now() });
  return currentSession(ctx);
}

export async function resumeSession(ctx: Ctx) {
  const s = await mustHave(ctx);
  if (s.paused_at) {
    const pausedFor = Math.max(0, ctx.nowDate.getTime() - Date.parse(s.paused_at));
    await save(ctx, { ...s, paused_at: null, paused_ms: (s.paused_ms ?? 0) + pausedFor });
  }
  return currentSession(ctx);
}

/** "Start break" / "Start work": begin the next pomodoro period now (also early). Resumes a paused session. */
export async function nextPeriod(ctx: Ctx) {
  let s = await mustHave(ctx);
  if (!s.pomodoro) throw bad('This session has no pomodoro');
  if (s.paused_at) {
    await resumeSession(ctx);
    s = await mustHave(ctx);
  }
  const worked = workedSeconds(s, ctx.nowDate.getTime());
  const view = pomodoroView(s, worked, ctx.nowDate.getTime(), true)!;
  const phase: Phase = view.phase === 'work' ? 'break' : 'work';
  await save(ctx, { ...s, phase, phase_start: worked, round: view.round + (phase === 'work' ? 1 : 0) });
  return currentSession(ctx);
}

/** Turn the pomodoro on (a work period starts now) or off for the running session. */
export async function setSessionPomodoro(ctx: Ctx, on: boolean) {
  const s = await mustHave(ctx);
  if (on === !!s.pomodoro) return currentSession(ctx);
  const d = await sessionDefaults(ctx);
  const worked = workedSeconds(s, ctx.nowDate.getTime());
  await save(ctx, on ? { ...s, pomodoro: { work: d.work, break: d.break }, phase: 'work', phase_start: worked, round: 1 } : { ...s, pomodoro: null });
  return currentSession(ctx);
}

/**
 * "Keep going": add minutes to the planned time, counted from now or from the
 * planned end if that is later. null = no limit from now on.
 */
export async function extendSession(ctx: Ctx, minutes: number | null) {
  const s = await mustHave(ctx);
  const m = checkMinutes(minutes, 'minutes');
  const worked = workedSeconds(s, ctx.nowDate.getTime());
  await save(ctx, { ...s, planned_sec: m === null ? null : Math.max(worked, s.planned_sec ?? worked) + m * 60 });
  return currentSession(ctx);
}

/** Stop the running session with a shutdown note (where you stopped); logs the minutes worked. */
export async function stopSession(ctx: Ctx, input: { where_stopped?: string; discard?: boolean }) {
  const s = await mustHave(ctx);
  await save(ctx, null);
  if (input.discard) return { discarded: true };
  const minutes = Math.max(1, Math.round(workedSeconds(s, ctx.nowDate.getTime()) / 60));
  const day = await ctx.today();
  const entry = await create(ctx, logEntity, {
    project_id: s.project_id,
    date: day,
    started: s.started,
    ended: ctx.now(),
    minutes,
    where_stopped: input.where_stopped ?? null,
  });
  if (s.project_id && (await find(ctx, projectsEntity, s.project_id))) {
    await update(ctx, projectsEntity, s.project_id, { last_touched: day });
  }
  return entry;
}

/**
 * Notices due for the running session (made into notifications by the
 * notifications module): the end of a pomodoro period, and the planned time
 * being up. Pure, so it is cheap on every status read.
 */
export function sessionNotices(s: StoredSession | null, now: number, waits: boolean, projectName?: string | null) {
  const out: { kind: 'pomodoro' | 'session'; title: string; body: string; due: string; dedupe_key: string }[] = [];
  if (!s) return out;
  const worked = workedSeconds(s, now);
  // The wall time when the session had worked w seconds (exact unless paused since then).
  const at = (w: number) => {
    const pausedNow = s.paused_at ? now - Date.parse(s.paused_at) : 0;
    return new Date(Math.min(now, now - pausedNow - (worked - w) * 1000)).toISOString();
  };
  const p = pomodoroView(s, worked, now, waits);
  if (p && waits && p.waiting) {
    const len = (p.phase === 'work' ? p.work : p.break) * 60;
    out.push({
      kind: 'pomodoro',
      title: p.phase === 'work' ? 'Time for a break' : 'Break over',
      body: p.phase === 'work' ? `Work period ${p.round} is over. Start the break when you are ready.` : 'Start work when you are ready.',
      due: at(p.phase_started_at_worked + len),
      dedupe_key: `pomodoro:${s.started}:${p.round}:${p.phase}-end`,
    });
  } else if (p && !waits && (p.round > 1 || p.phase === 'break')) {
    out.push({
      kind: 'pomodoro',
      title: p.phase === 'break' ? 'Break time' : 'Back to work',
      body: p.phase === 'break' ? `${p.break} minutes. Stand up and stretch.` : `Round ${p.round} of the session.`,
      due: at(p.phase_started_at_worked),
      dedupe_key: `pomodoro:${s.started}:${p.round}:${p.phase}`,
    });
  }
  const planned = plannedView(s, worked);
  if (planned?.time_up) {
    out.push({
      kind: 'session',
      title: 'Time is up',
      body: `${planned.minutes} min${projectName ? ` on ${projectName}` : ''}. Finish or keep going.`,
      due: at(s.planned_sec!),
      dedupe_key: `timeup:${s.started}:${s.planned_sec}`,
    });
  }
  return out;
}

export const storedSession = stored;

const minutes = z.number().int().min(1).max(MAX_MIN);

export const sessionsModule: Module = {
  id: 'sessions',
  description: 'Work sessions: start, pause, resume, a pomodoro that waits for a click, planned length, finish with a note.',
  // The planned length a new session starts with (the last one chosen): this profile's or every profile's (D46).
  scopedSettings: [{ id: 'session.length', key: LENGTH_KEY, label: 'Planned length of a new session', section: 'pomodoro', parse: parseLength }],
  features: [
    {
      id: 'pomodoro-waits-for-click',
      label: 'Pomodoro waits for a click',
      description: 'When a work or break period ends, the timer alerts and waits for "Start break" or "Start work". Off: periods follow each other by themselves.',
      default: true,
    },
    {
      id: 'corner-timer',
      label: 'Corner timer',
      description: 'A small timer in a corner of every page while a session runs (not on Today). Drag it anywhere; double-click its grip to put it back.',
      default: true,
    },
  ],
  routes(api) {
    api.get('/session', async (c) => c.json(await currentSession(c.get('ctx'))));
    // Everything the session controls need in one small call: the session, today's focus and the start defaults.
    api.get('/session/state', async (c) => {
      const ctx = c.get('ctx');
      const day = await ctx.today();
      const focusId = await ctx.setting(`focus.${day}`);
      const focus = focusId ? await find(ctx, projectsEntity, focusId) : null;
      return c.json({
        day,
        focus: focus ? { id: focus.id, name: focus.name } : null,
        session: await currentSession(ctx),
        defaults: await sessionDefaults(ctx),
      });
    });
    api.post('/session/start', async (c) => {
      const ctx = c.get('ctx');
      ctx.label = 'start session';
      return c.json(await startSession(ctx, await c.req.json().catch(() => ({}))));
    });
    api.post('/session/pause', async (c) => c.json(await pauseSession(c.get('ctx'))));
    api.post('/session/resume', async (c) => c.json(await resumeSession(c.get('ctx'))));
    api.post('/session/next', async (c) => c.json(await nextPeriod(c.get('ctx'))));
    api.post('/session/pomodoro', async (c) => {
      const b = await c.req.json<{ on?: boolean }>().catch(() => ({}) as { on?: boolean });
      if (typeof b.on !== 'boolean') throw bad('Send { "on": true } or { "on": false }');
      return c.json(await setSessionPomodoro(c.get('ctx'), b.on));
    });
    api.post('/session/extend', async (c) => {
      const b = await c.req.json<{ minutes?: number | null }>().catch(() => ({}) as { minutes?: number | null });
      if (b.minutes === undefined) throw bad('Send { "minutes": 10 } (or null for no limit)');
      return c.json(await extendSession(c.get('ctx'), b.minutes));
    });
    api.post('/session/stop', async (c) => {
      const ctx = c.get('ctx');
      ctx.label = 'finish session';
      return c.json(await stopSession(ctx, await c.req.json().catch(() => ({}))));
    });
  },
  tools: [
    {
      name: 'start_session',
      description:
        'Start a work session on a project (default: today’s focus). The pomodoro follows the owner’s setting unless given; planned_min is the planned length (1–600, null = no limit; default: the length used last).',
      input: z.object({ project_id: z.string().optional(), pomodoro: z.boolean().optional(), planned_min: minutes.nullable().optional() }),
      run: (ctx, a) => startSession(ctx, a),
    },
    {
      name: 'pause_session',
      description: 'Pause the running session. Paused time is not counted in the minutes worked, the pomodoro or the planned time.',
      input: z.object({}),
      run: (ctx) => pauseSession(ctx),
    },
    {
      name: 'resume_session',
      description: 'Resume a paused session.',
      input: z.object({}),
      run: (ctx) => resumeSession(ctx),
    },
    {
      name: 'stop_session',
      description: 'Finish the running session with a shutdown note (where you stopped). It is logged with the minutes worked (pauses left out). discard: true drops it without a log line.',
      input: z.object({ where_stopped: z.string().optional(), discard: z.boolean().optional() }),
      run: (ctx, a) => stopSession(ctx, a),
    },
  ],
};
