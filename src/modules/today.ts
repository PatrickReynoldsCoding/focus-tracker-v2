// Today: the day's focus project, the weekly rotation, swapping focus (with a
// reminder about the skipped project), the session log, and the compact status
// for widgets and the menu bar. Running sessions are in sessions.ts.

import { z } from 'zod';
import { addDays, checkDay, type Ctx } from '../core/ctx';
import { changesFor, leadOn, loadRotation, mondayOf, setWeekChanges, WEEKDAYS, weekdayOf } from '../core/rotation';
import type { Entity, Row } from '../core/entity';
import { bad } from '../core/errors';
import type { Module } from '../core/registry';
import { create, find, get, list, update } from '../core/store';
import { habitProgress } from './habits';
import { listsEntity } from './lists';
import { todosForDay } from './todos';
import { pendingNotifications } from './notifications';
import { projectsEntity } from './projects';
import { currentPomodoro } from './pomodoro';
import { currentSession } from './sessions';
import { notBlockedSql } from './relations';
import { buildTodayList } from '../core/today-list';
import { cardsForDay, notTodayKeys, TODAY_LIST_FLAG, todoListNames, todoListProjects, withListNames } from './today-list';

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

// ---------- rotation (stored and rolled over in src/core/rotation.ts) ----------

/** The rotation: per weekday a category id, 'away' or 'any'. With the changes for the week that holds `day`, and next week's. */
export async function rotation(ctx: Ctx, day?: string) {
  const r = await loadRotation(ctx);
  const d = day ?? r.today;
  const monday = mondayOf(d);
  return {
    usual: r.usual,
    this_week: changesFor(r, d),
    week_of: monday,
    next_week: r.next.of === r.next_monday ? r.next.days : {},
    next_week_of: r.next_monday,
    today: { day: d, weekday: weekdayOf(d), category: leadOn(r, d).value },
  };
}

export async function setRotation(ctx: Ctx, input: { usual?: Record<string, string | null>; this_week?: Record<string, string | null>; next_week?: Record<string, string | null> }) {
  if (input.usual) {
    for (const [w, v] of Object.entries(input.usual)) {
      if (!WEEKDAYS.includes(w as never)) throw bad(`Unknown weekday ${w}`);
      await ctx.setSetting(`rotation.${w}`, v || null);
    }
  }
  if (input.this_week) await setWeekChanges(ctx, 'week', input.this_week);
  if (input.next_week) await setWeekChanges(ctx, 'next', input.next_week);
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
  const free = await notBlockedSql(ctx); // issue links: leave out projects blocked by an unfinished item
  return list(ctx, projectsEntity, {
    where,
    sql: `(locked_until IS NULL OR locked_until <= ?) AND ${free.sql}`,
    params: [today, ...free.params],
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
 * skipped one is remembered and, unless remind_in_days is null, a reminder
 * about it is set that many days later (default 1: tomorrow).
 */
export async function setFocus(ctx: Ctx, projectId: string | null, opts: { day?: string; remind_in_days?: number | null } = {}) {
  const day = opts.day ? checkDay(opts.day) : await ctx.today();
  const remindIn = opts.remind_in_days === undefined ? 1 : opts.remind_in_days;
  if (remindIn !== null && (!Number.isInteger(remindIn) || remindIn < 1 || remindIn > 365)) throw bad('remind_in_days must be whole days from 1 to 365, or null for no reminder');
  const before = await focusOf(ctx, day);
  if (projectId) {
    const p = await get(ctx, projectsEntity, projectId);
    if (before && before.id !== p.id) {
      await create(ctx, skipsEntity, { project_id: before.id, to_project_id: p.id, date: day });
      if (remindIn !== null) {
        await create(ctx, remindersEntity, {
          project_id: before.id,
          text: `You swapped away from ${before.name} on ${day}. Pick it up again?`,
          due: `${addDays(day, remindIn)}T08:00:00.000Z`,
        });
      }
    }
  }
  await ctx.setSetting(`focus.${day}`, projectId);
  return today(ctx);
}

/**
 * Every project that could be today's focus, ranked as Today ranks its
 * suggestions: today's rotation category first, then least recently touched.
 * Locked and blocked projects are left out.
 */
export async function focusCandidates(ctx: Ctx) {
  const day = await ctx.today();
  const category = (await rotation(ctx, day)).today.category;
  const free = await notBlockedSql(ctx); // like the suggestions: blocked projects are left out
  const rows = await list(ctx, projectsEntity, {
    where: { status: 'active' },
    sql: `(locked_until IS NULL OR locked_until <= ?) AND ${free.sql}`,
    params: [day, ...free.params],
    order: 'last_touched IS NOT NULL, last_touched, name',
  });
  const fits = (p: Row) => !!category && category !== 'any' && category !== 'away' && p.category_id === category;
  return {
    day,
    category,
    projects: [...rows.filter(fits), ...rows.filter((p) => !fits(p))].map((p) => ({ ...p, in_rotation: fits(p) })),
  };
}

// ---------- sessions (src/modules/sessions.ts) ----------

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
  const withList = await ctx.feature(TODAY_LIST_FLAG);
  const [focus, rot, session, todos, habits, lists, nudge, cards, todoLists, todoListProject] = await Promise.all([
    focusOf(ctx, day),
    rotation(ctx, day),
    currentSession(ctx),
    todosForDay(ctx, day),
    habitProgress(ctx, day),
    list(ctx, listsEntity, { where: { show_today: true } }),
    neglected(ctx, day),
    withList ? cardsForDay(ctx, day) : [],
    withList ? todoListNames(ctx) : {},
    withList ? todoListProjects(ctx) : {},
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
    pomodoro: await currentPomodoro(ctx),
    todos,
    habits,
    lists,
    neglected: nudge,
    // The Today list (flag today-panel) also needs the cards for today and, with several to-do lists, their names.
    cards,
    todo_lists: todoLists,
    // A to-do list's project (list id → project id), so a to-do from a project's list says which.
    todo_list_projects: todoListProject,
  };
}

/** Small and cheap: for widgets, the menu bar and quick polls. */
export async function status(ctx: Ctx) {
  const day = await ctx.today();
  const [focus, session, todos, habits, notes, extra] = await Promise.all([
    focusOf(ctx, day),
    currentSession(ctx),
    todosForDay(ctx, day),
    habitProgress(ctx, day),
    pendingNotifications(ctx),
    ctx.feature(TODAY_LIST_FLAG).then(async (on) => (on ? { cards: await cardsForDay(ctx, day), names: await todoListNames(ctx) } : null)),
  ]);
  const list = extra && buildTodayList(day, { habits, todos: withListNames(todos, extra.names), cards: extra.cards, hide: await notTodayKeys(ctx, day) });
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
      worked_seconds: session.worked_seconds,
      paused: session.paused,
      pomodoro: session.pomodoro,
      planned: session.planned,
    },
    pomodoro: await currentPomodoro(ctx),
    todos_due: todos.filter((t) => !t.done).map((t) => ({ id: t.id, title: t.title, day: t.day })),
    habits_left: habits.filter((h) => h.left > 0).map((h) => ({ id: h.id, name: h.name, left: h.left, per: h.per })),
    // The Today list's open items (flag today-panel; null while it is off), for clients that show one list.
    today_list: list && {
      left: list.left,
      done: list.done,
      items: list.items.filter((x) => x.state === 'open').map((x) => ({ kind: x.kind, id: x.id, title: x.title, progress: x.progress ?? null, late: x.late ?? null })),
    },
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
      const b = await c.req.json<{ project_id: string | null; day?: string; remind_in_days?: number | null }>();
      return c.json(await setFocus(ctx, b.project_id ?? null, { day: b.day, remind_in_days: b.remind_in_days }));
    });
    api.get('/focus/candidates', async (c) => c.json(await focusCandidates(c.get('ctx'))));
    api.get('/rotation', async (c) => c.json(await rotation(c.get('ctx'))));
    api.put('/rotation', async (c) => c.json(await setRotation(c.get('ctx'), await c.req.json())));
  },
  tools: [
    {
      name: 'get_today',
      description:
        'Today: the focus project (none until the owner chooses one), rotation and suggestions, running session, to-dos due, habits, cards for today, lists shown on Today and neglected projects. get_today_list gives the Today list the owner sees.',
      readOnly: true,
      input: z.object({}),
      run: (ctx) => today(ctx),
    },
    {
      name: 'set_focus',
      description:
        'Choose today’s focus project (or null to clear). Swapping away from another project remembers the skip and sets a reminder about it after remind_in_days (default 1, tomorrow; null for none). Only do this when the owner asks.',
      input: z.object({ project_id: z.string().nullable(), day: z.string().optional(), remind_in_days: z.number().int().min(1).max(365).nullable().optional() }),
      run: (ctx, a) => setFocus(ctx, a.project_id, { day: a.day, remind_in_days: a.remind_in_days }),
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
      description: 'The weekly rotation: which category each weekday is for (or away/any), with this week’s changes and next week’s (next_week, made in Plan my week).',
      readOnly: true,
      input: z.object({}),
      run: (ctx) => rotation(ctx),
    },
    {
      name: 'set_rotation',
      description:
        'Change the usual weekly rotation, just this week and/or just next week (keys are weekdays: monday … sunday). Values: a category id, "away", "any", or null to reset. Next week’s changes become this week’s when it starts.',
      input: z.object({
        usual: z.record(z.string(), z.string().nullable()).optional(),
        this_week: z.record(z.string(), z.string().nullable()).optional(),
        next_week: z.record(z.string(), z.string().nullable()).optional(),
      }),
      run: (ctx, a) => setRotation(ctx, a),
    },
  ],
};
