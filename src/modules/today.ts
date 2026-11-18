// Today: the day's focus project, the weekly rotation, swapping focus (with a
// reminder about the skipped project), work sessions with a pomodoro timer,
// the session log, and the compact status for widgets and the menu bar.

import { z } from 'zod';
import { addDays, checkDay, weekdayIn, type Ctx } from '../core/ctx';
import type { Entity, Row } from '../core/entity';
import { bad } from '../core/errors';
import type { Module } from '../core/registry';
import { create, find, get, list, update } from '../core/store';
import { habitProgress } from './habits';
import { listsEntity, todosForDay } from './lists';
import { pendingNotifications } from './notifications';
import { projectsEntity } from './projects';

export const logEntity: Entity = {
  name: 'log',
  table: 'log',
  singular: 'session',
  desc: 'Finished work sessions: when, on which project and where the owner stopped.',
  modeScoped: true,
  filters: ['project_id', 'date'],
  sort: 'date DESC, created DESC',
  fields: {
    project_id: { type: 'text', ref: 'projects' },
    date: { type: 'day', required: true },
    started: { type: 'time' },
    ended: { type: 'time' },
    minutes: { type: 'int' },
    where_stopped: { type: 'text' },
  },
};

export const skipsEntity: Entity = {
  name: 'skips',
  table: 'skips',
  singular: 'skip',
  desc: 'A day the focus was swapped away from a project.',
  modeScoped: true,
  internal: true,
  filters: ['project_id', 'date'],
  fields: {
    project_id: { type: 'text', required: true, ref: 'projects', cascade: true },
    to_project_id: { type: 'text', ref: 'projects' },
    date: { type: 'day', required: true },
  },
};

export const remindersEntity: Entity = {
  name: 'reminders',
  table: 'reminders',
  singular: 'reminder',
  desc: 'Reminders, optionally about a project. When due they become notifications.',
  modeScoped: true,
  filters: ['project_id', 'done'],
  sort: 'due',
  fields: {
    project_id: { type: 'text', ref: 'projects', cascade: true },
    text: { type: 'text' },
    due: { type: 'time', required: true },
    done: { type: 'time' },
  },
};

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

// ---------- rotation ----------

/** The rotation: per weekday a category id, 'away' or 'any'. With this week's changes applied. */
export async function rotation(ctx: Ctx, day?: string) {
  const d = day ?? (await ctx.today());
  const usual: Record<string, string> = {};
  for (const w of WEEKDAYS) usual[w] = (await ctx.setting(`rotation.${w}`)) ?? 'any';
  const weekOf = await ctx.setting('week.of');
  const monday = (await import('./habits')).mondayOf(d);
  const thisWeek: Record<string, string> = {};
  if (weekOf === monday) {
    for (const w of WEEKDAYS) {
      const v = await ctx.setting(`week.${w}`);
      if (v) thisWeek[w] = v;
    }
  }
  const weekday = weekdayIn(new Date(`${d}T12:00:00Z`), 'UTC');
  return { usual, this_week: thisWeek, week_of: monday, today: { day: d, weekday, category: thisWeek[weekday] ?? usual[weekday] } };
}

export async function setRotation(ctx: Ctx, input: { usual?: Record<string, string | null>; this_week?: Record<string, string | null> }) {
  for (const [part, prefix] of [
    ['usual', 'rotation'],
    ['this_week', 'week'],
  ] as const) {
    const values = input[part];
    if (!values) continue;
    for (const [w, v] of Object.entries(values)) {
      if (!WEEKDAYS.includes(w as never)) throw bad(`Unknown weekday ${w}`);
      await ctx.setSetting(`${prefix}.${w}`, v || null);
    }
    if (part === 'this_week') await ctx.setSetting('week.of', (await rotation(ctx)).week_of);
  }
  return rotation(ctx);
}

/** Active projects nobody touched for a while (the nudge). */
export async function neglected(ctx: Ctx, today: string) {
  const days = Number((await ctx.setting('nudge.days')) ?? 14);
  const cutoff = addDays(today, -days);
  return list(ctx, projectsEntity, {
    where: { status: 'active' },
    sql: '(last_touched IS NULL OR last_touched < ?) AND (locked_until IS NULL OR locked_until <= ?)',
    params: [cutoff, today],
    order: 'last_touched',
    limit: 10,
  });
}

/** Projects that fit today's rotation, least recently touched first. Never picked automatically. */
async function suggestions(ctx: Ctx, today: string, category: string | undefined) {
  if (category === 'away') return [];
  const where: Record<string, unknown> = { status: 'active' };
  if (category && category !== 'any') where.category_id = category;
  return list(ctx, projectsEntity, {
    where,
    sql: 'locked_until IS NULL OR locked_until <= ?',
    params: [today],
    order: 'last_touched IS NOT NULL, last_touched',
    limit: 5,
  });
}

// ---------- focus ----------

export async function focusOf(ctx: Ctx, day: string): Promise<Row | null> {
  const id = await ctx.setting(`focus.${day}`);
  return id ? find(ctx, projectsEntity, id) : null;
}

/**
 * Choose the day's focus project. When it replaces another project, the
 * skipped one is remembered and a reminder about it is set for the next day.
 */
export async function setFocus(ctx: Ctx, projectId: string | null, opts: { day?: string; remind_in_days?: number } = {}) {
  const day = opts.day ? checkDay(opts.day) : await ctx.today();
  const before = await focusOf(ctx, day);
  if (projectId) {
    const p = await get(ctx, projectsEntity, projectId);
    if (before && before.id !== p.id) {
      await create(ctx, skipsEntity, { project_id: before.id, to_project_id: p.id, date: day });
      const dueDay = addDays(day, opts.remind_in_days ?? 1);
      await create(ctx, remindersEntity, {
        project_id: before.id,
        text: `You swapped away from ${before.name} on ${day}. Pick it up again?`,
        due: `${dueDay}T08:00:00.000Z`,
      });
    }
  }
  await ctx.setSetting(`focus.${day}`, projectId);
  return today(ctx);
}

// ---------- sessions ----------

interface RunningSession {
  project_id: string | null;
  started: string;
  pomodoro: { work: number; break: number } | null;
}

export async function currentSession(ctx: Ctx) {
  const s = await ctx.jsonSetting<RunningSession | null>('session.current', null);
  if (!s) return null;
  const now = ctx.nowDate.getTime();
  const elapsed = Math.max(0, Math.floor((now - Date.parse(s.started)) / 1000));
  let pomodoro = null;
  if (s.pomodoro) {
    const work = s.pomodoro.work * 60;
    const cycle = work + s.pomodoro.break * 60;
    const inCycle = elapsed % cycle;
    const round = Math.floor(elapsed / cycle) + 1;
    const phase = inCycle < work ? 'work' : 'break';
    const left = phase === 'work' ? work - inCycle : cycle - inCycle;
    pomodoro = { ...s.pomodoro, round, phase, seconds_left: left, phase_ends_at: new Date(now + left * 1000).toISOString() };
  }
  const project = s.project_id ? await find(ctx, projectsEntity, s.project_id) : null;
  return { ...s, project_name: project?.name ?? null, elapsed_seconds: elapsed, pomodoro };
}

export async function startSession(ctx: Ctx, input: { project_id?: string; pomodoro?: boolean; work?: number; break?: number }) {
  if (await ctx.setting('session.current')) throw bad('A session is already running. Stop it first.');
  const day = await ctx.today();
  const projectId = input.project_id ?? (await ctx.setting(`focus.${day}`));
  if (!projectId) throw bad('No project given and no focus project chosen for today');
  await get(ctx, projectsEntity, projectId);
  const pomodoroDefault = (await ctx.setting('pomodoro.default')) !== 'off';
  const usePomodoro = input.pomodoro ?? pomodoroDefault;
  const s: RunningSession = {
    project_id: projectId,
    started: ctx.now(),
    pomodoro: usePomodoro
      ? { work: input.work ?? Number((await ctx.setting('pomodoro.work')) ?? 25), break: input.break ?? Number((await ctx.setting('pomodoro.break')) ?? 5) }
      : null,
  };
  await ctx.setSetting('session.current', JSON.stringify(s));
  return currentSession(ctx);
}

/** Stop the running session with a shutdown note (where you stopped); logs it. */
export async function stopSession(ctx: Ctx, input: { where_stopped?: string; discard?: boolean }) {
  const s = await ctx.jsonSetting<RunningSession | null>('session.current', null);
  if (!s) throw bad('No session is running');
  await ctx.setSetting('session.current', null);
  if (input.discard) return { discarded: true };
  const minutes = Math.max(1, Math.round((ctx.nowDate.getTime() - Date.parse(s.started)) / 60000));
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
    const patch: Record<string, unknown> = { last_touched: day };
    await update(ctx, projectsEntity, s.project_id, patch);
  }
  return entry;
}

/** Log a session after the fact (for example one Claude helped with). */
export async function logSession(ctx: Ctx, input: { project_id?: string; date?: string; minutes?: number; where_stopped?: string }) {
  const day = input.date ?? (await ctx.today());
  const entry = await create(ctx, logEntity, { ...input, date: day });
  if (input.project_id) {
    const p = await get(ctx, projectsEntity, input.project_id);
    const patch: Record<string, unknown> = {};
    if (!p.last_touched || String(p.last_touched) < day) patch.last_touched = day;
    if (Object.keys(patch).length) await update(ctx, projectsEntity, p.id, patch);
  }
  return entry;
}

// ---------- today and status ----------

export async function today(ctx: Ctx) {
  const day = await ctx.today();
  const [focus, rot, session, todos, habits, lists, nudge] = await Promise.all([
    focusOf(ctx, day),
    rotation(ctx, day),
    currentSession(ctx),
    todosForDay(ctx, day),
    habitProgress(ctx, day),
    list(ctx, listsEntity, { where: { show_today: true } }),
    neglected(ctx, day),
  ]);
  return {
    mode: ctx.mode,
    day,
    focus,
    // Session controls are hidden in the app when no focus is chosen (owner's rule from v1).
    show_session_controls: !!focus || !!session,
    rotation: rot.today,
    suggestions: focus ? [] : await suggestions(ctx, day, rot.today.category),
    session,
    todos,
    habits,
    lists,
    neglected: nudge,
  };
}

/** Small and cheap: for widgets, the menu bar and quick polls. */
export async function status(ctx: Ctx) {
  const day = await ctx.today();
  const [focus, session, todos, habits, notes] = await Promise.all([
    focusOf(ctx, day),
    currentSession(ctx),
    todosForDay(ctx, day),
    habitProgress(ctx, day),
    pendingNotifications(ctx),
  ]);
  return {
    mode: ctx.mode,
    day,
    now: ctx.now(),
    focus: focus ? { id: focus.id, name: focus.name } : null,
    session: session && {
      project_id: session.project_id,
      project_name: session.project_name,
      started: session.started,
      elapsed_seconds: session.elapsed_seconds,
      pomodoro: session.pomodoro,
    },
    todos_due: todos.filter((t) => !t.done).map((t) => ({ id: t.id, title: t.title, day: t.day })),
    habits_left: habits.filter((h) => h.left > 0).map((h) => ({ id: h.id, name: h.name, left: h.left, per: h.per })),
    notifications: notes,
  };
}

export const todayModule: Module = {
  id: 'today',
  description: 'Today view, focus, weekly rotation, sessions with pomodoro, session log and reminders.',
  entities: [logEntity, skipsEntity, remindersEntity],
  routes(api) {
    api.get('/today', async (c) => c.json(await today(c.get('ctx'))));
    api.get('/status', async (c) => c.json(await status(c.get('ctx'))));
    api.put('/focus', async (c) => {
      const ctx = c.get('ctx');
      ctx.label = 'choose focus';
      const b = await c.req.json<{ project_id: string | null; day?: string }>();
      return c.json(await setFocus(ctx, b.project_id ?? null, { day: b.day }));
    });
    api.get('/rotation', async (c) => c.json(await rotation(c.get('ctx'))));
    api.put('/rotation', async (c) => c.json(await setRotation(c.get('ctx'), await c.req.json())));
    api.get('/session', async (c) => c.json(await currentSession(c.get('ctx'))));
    api.post('/session/start', async (c) => {
      const ctx = c.get('ctx');
      return c.json(await startSession(ctx, await c.req.json().catch(() => ({}))));
    });
    api.post('/session/stop', async (c) => {
      const ctx = c.get('ctx');
      ctx.label = 'finish session';
      return c.json(await stopSession(ctx, await c.req.json().catch(() => ({}))));
    });
  },
  tools: [
    {
      name: 'get_today',
      description:
        'Today: the focus project (none until the owner chooses one), rotation and suggestions, running session, to-dos due, habits, lists shown on Today and neglected projects.',
      readOnly: true,
      input: z.object({}),
      run: (ctx) => today(ctx),
    },
    {
      name: 'set_focus',
      description:
        'Choose today’s focus project (or null to clear). Swapping away from another project remembers the skip and sets a reminder about it for the next day. Only do this when the owner asks.',
      input: z.object({ project_id: z.string().nullable(), day: z.string().optional() }),
      run: (ctx, a) => setFocus(ctx, a.project_id, { day: a.day }),
    },
    {
      name: 'start_session',
      description: 'Start a work session on a project (default: today’s focus), with a pomodoro timer unless turned off.',
      input: z.object({ project_id: z.string().optional(), pomodoro: z.boolean().optional() }),
      run: (ctx, a) => startSession(ctx, a),
    },
    {
      name: 'stop_session',
      description: 'Finish the running session with a shutdown note (where you stopped). It is logged.',
      input: z.object({ where_stopped: z.string().optional(), discard: z.boolean().optional() }),
      run: (ctx, a) => stopSession(ctx, a),
    },
    {
      name: 'log_session',
      description: 'Log a session after the fact. Updates the project’s last touched day.',
      input: z.object({
        project_id: z.string().optional(),
        date: z.string().optional(),
        minutes: z.number().int().optional(),
        where_stopped: z.string().optional(),
      }),
      run: (ctx, a) => logSession(ctx, a),
    },
    {
      name: 'get_rotation',
      description: 'The weekly rotation: which category each weekday is for (or away/any), with this week’s changes.',
      readOnly: true,
      input: z.object({}),
      run: (ctx) => rotation(ctx),
    },
    {
      name: 'set_rotation',
      description: 'Change the usual weekly rotation and/or just this week. Values: a category id, "away", "any", or null to reset.',
      input: z.object({
        usual: z.record(z.string(), z.string().nullable()).optional(),
        this_week: z.record(z.string(), z.string().nullable()).optional(),
      }),
      run: (ctx, a) => setRotation(ctx, a),
    },
  ],
};
