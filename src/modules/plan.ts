// Plan my week: this week or next week, Monday to Sunday in the owner's time zone. For each day:
// the focus lead (the rotation, with this week's or next week's changes), planned habit sessions
// (habit_log rows of kind 'plan', count = sessions planned that day) and the to-dos on that day
// (todos.day). Nothing has a time of day, and there is no week after next, by design.
// See docs/DECISIONS.md "D26".

import { z } from 'zod';
import { addDays, checkDay, type Ctx } from '../core/ctx';
import type { Row } from '../core/entity';
import { bad } from '../core/errors';
import { requireFeature } from '../core/features';
import { formatLevel } from '../core/habit-levels';
import type { Module } from '../core/registry';
import { leadOn, loadRotation, setWeekChanges, weekdayOf, type Rotation } from '../core/rotation';
import { create, get, list, remove, update } from '../core/store';
import { categoriesEntity } from './basics';
import { AWAY_FLAG, habitLogEntity, habitsEntity, levelForDay, levelHistory } from './habits';
import { listsEntity } from './lists';
import { readTodos, updateTodo } from './todos';

export const PLAN_FLAG = 'plan-week';
/** A day holds at most this many planned sessions of one habit. */
const MAX_PLANNED = 20;

export type Which = 'this' | 'next';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** The days that can be planned: today to next Sunday. */
function planRange(r: Rotation) {
  return { from: r.today, to: addDays(r.next_monday, 6) };
}

function checkPlanDay(r: Rotation, day: string, what: string) {
  checkDay(day);
  const { from, to } = planRange(r);
  if (day < from) throw bad(`${what} is for today and later; past days only show what was done`);
  if (day > to) throw bad(`Plan my week goes as far as next Sunday (${to})`);
}

const todoOut = (t: Row) => ({ id: t.id, title: t.title, day: t.day ?? null, done: t.done ?? null, project_id: t.project_id ?? null, list_id: t.list_id });

/** The plan for this week or next week. Rolls next week's rotation over into this week when it has started. */
export async function weekPlan(ctx: Ctx, which: Which = 'this') {
  const r = await loadRotation(ctx);
  const today = r.today;
  const monday = which === 'next' ? r.next_monday : r.this_monday;
  const sunday = addDays(monday, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  // To-dos still open from before: before this week (this week's past days show their own), or before today for next week.
  const earlierThan = which === 'this' ? monday : today;
  const [cats, habits, logs, levels, todos, loose, awayOn, todoLists] = await Promise.all([
    list(ctx, categoriesEntity),
    list(ctx, habitsEntity, { where: { status: 'active' } }),
    list(ctx, habitLogEntity, { sql: "day >= ? AND day <= ? AND kind IN ('done', 'plan', 'skip')", params: [monday, sunday], limit: 2000 }),
    list(ctx, habitLogEntity, { where: { kind: 'level' }, order: 'day', limit: 2000 }),
    readTodos(ctx, { sql: 'day >= ? AND day <= ?', params: [monday, sunday], order: 'day, done IS NOT NULL, ord', limit: 500 }),
    readTodos(ctx, { sql: 'done IS NULL AND (day IS NULL OR day < ?)', params: [earlierThan], order: 'day IS NOT NULL, day, ord', limit: 200 }),
    ctx.feature(AWAY_FLAG),
    list(ctx, listsEntity, { where: { kind: 'todo' } }),
  ]);
  const countOf = (habitId: string, kind: string, day: string) => sum(logs.filter((l) => l.habit_id === habitId && l.kind === kind && l.day === day).map((l) => Number(l.count ?? 0)));
  const dayRows = days.map((day) => {
    const lead = leadOn(r, day);
    return {
      day,
      weekday: weekdayOf(day),
      past: day < today,
      today: day === today,
      lead,
      away: lead.value === 'away',
      habits: habits
        .map((h) => ({ habit_id: String(h.id), planned: countOf(h.id, 'plan', day), done: countOf(h.id, 'done', day), skipped: countOf(h.id, 'skip', day) > 0 }))
        .filter((x) => x.planned || x.done || x.skipped),
      todos: todos.filter((t) => t.day === day).map(todoOut),
    };
  });
  const awayDays = dayRows.filter((d) => d.away).map((d) => d.day);
  const habitRows = habits.map((h) => {
    const history = levelHistory(h, levels);
    const level = levelForDay(h, history, monday);
    const started = typeof h.started === 'string' && h.started > monday ? h.started : monday;
    let target: number;
    let leftOut = 0;
    if (level.per === 'week') target = level.sessions ?? 0;
    else {
      // A daily habit's week: each day from its start, less away days while the flag is on.
      const asked = days.filter((d) => d >= started && !(awayOn && awayDays.includes(d)));
      leftOut = awayOn ? days.filter((d) => d >= started && awayDays.includes(d)).length : 0;
      target = asked.length * (level.sessions ?? 0);
    }
    const planned = sum(days.map((d) => countOf(h.id, 'plan', d)));
    const done = sum(days.map((d) => countOf(h.id, 'done', d)));
    return {
      id: String(h.id),
      name: String(h.name),
      per: level.per,
      sessions: level.sessions,
      level: formatLevel(level),
      /** Sessions the week asks for. */
      target,
      planned,
      done,
      /** Away days left out of a daily habit's target (flag away-lowers-targets). */
      away_days_left_out: leftOut,
    };
  });
  return {
    week: which,
    week_of: monday,
    end: sunday,
    today,
    plan_from: planRange(r).from,
    plan_to: planRange(r).to,
    away_lowers_targets: awayOn,
    categories: cats.map((c) => ({ id: String(c.id), label: String(c.label), color: (c.color as string | null) ?? null })),
    habits: habitRows,
    /** The to-do lists, in order; the first is where new to-dos go. */
    lists: todoLists.map((l) => ({ id: String(l.id), name: String(l.name) })),
    days: dayRows,
    /** Open to-dos with no day, then those from before (still open). */
    unscheduled: loose.filter((t) => t.day == null).map(todoOut),
    earlier: loose.filter((t) => t.day != null).map(todoOut),
  };
}

/** Add (or with a negative `add`, take off) planned sessions of a habit on a day from today to next Sunday. */
export async function planSession(ctx: Ctx, habitId: string, day: string, opts: { add?: number; count?: number }) {
  const r = await loadRotation(ctx);
  checkPlanDay(r, day, 'Planning a session');
  const h = await get(ctx, habitsEntity, habitId);
  if (h.status !== 'active') throw bad(`${h.name} is not active, so it cannot be planned`);
  const existing = (await list(ctx, habitLogEntity, { where: { habit_id: habitId, day, kind: 'plan' }, limit: 1 }))[0];
  const now = Number(existing?.count ?? 0);
  const next = opts.count != null ? opts.count : now + (opts.add ?? 1);
  if (!Number.isInteger(next)) throw bad('count must be a whole number');
  const count = Math.max(0, Math.min(MAX_PLANNED, next));
  if (count === 0) {
    if (existing) await remove(ctx, habitLogEntity, existing.id);
  } else if (existing) await update(ctx, habitLogEntity, existing.id, { count });
  else await create(ctx, habitLogEntity, { habit_id: habitId, day, kind: 'plan', count });
  return { habit_id: habitId, name: h.name, day, planned: count };
}

/** Change what one day is for (a category id, "any" or "away"; null or the usual value = back to the usual). */
export async function setLead(ctx: Ctx, day: string, value: string | null) {
  const r = await loadRotation(ctx);
  checkPlanDay(r, day, 'Changing the focus lead');
  if (value != null && value !== 'any' && value !== 'away') await get(ctx, categoriesEntity, value);
  const w = weekdayOf(day);
  const which = day < r.next_monday ? 'week' : 'next';
  const after = await setWeekChanges(ctx, which, { [w]: value == null || value === r.usual[w] ? null : value });
  return { day, ...leadOn(after, day) };
}

/** Put a to-do on a day, or take it off (null = anytime). The same as changing todos.day. */
export async function scheduleTodo(ctx: Ctx, id: string, day: string | null) {
  if (day != null) checkDay(day);
  return updateTodo(ctx, id, { day });
}

const which = (v: unknown): Which => (v === 'next' ? 'next' : 'this');

export const planModule: Module = {
  id: 'plan',
  description: 'Plan my week: the focus lead per day, planned habit sessions and to-dos on days, for this week or next week.',
  features: [
    {
      id: PLAN_FLAG,
      label: 'Plan my week',
      description: 'Plan this week or next: what each day is for, habit sessions on days and to-dos on days. Opened from Today and the Habits tab.',
      default: true,
    },
  ],
  routes(api) {
    const on = async (c: { get(k: 'ctx'): Ctx }) => {
      const ctx = c.get('ctx');
      await requireFeature(ctx, PLAN_FLAG);
      return ctx;
    };
    api.get('/plan', async (c) => c.json(await weekPlan(await on(c), which(c.req.query('week')))));
    api.post('/plan/sessions', async (c) => {
      const ctx = await on(c);
      const b = await c.req.json<{ habit_id?: string; day?: string; add?: number; count?: number }>().catch(() => ({}) as Record<string, never>);
      if (!b.habit_id) throw bad('habit_id is needed');
      ctx.label = (b.add ?? 1) < 0 || b.count === 0 ? 'unplan session' : 'plan session';
      return c.json(await planSession(ctx, b.habit_id, String(b.day ?? ''), { add: b.add, count: b.count }));
    });
    api.put('/plan/lead', async (c) => {
      const ctx = await on(c);
      const b = await c.req.json<{ day?: string; value?: string | null }>().catch(() => ({}) as Record<string, never>);
      return c.json(await setLead(ctx, String(b.day ?? ''), b.value ?? null));
    });
  },
  tools: [
    {
      name: 'get_week_plan',
      description:
        'Plan my week for this week or next ("this" / "next", Monday to Sunday): per day the focus lead (category id, "any" or "away", and whether it differs from the usual rotation), ' +
        'planned and done habit sessions, and the to-dos on that day; per habit the sessions the week asks for (target), planned and done; and open to-dos with no day or from earlier.',
      readOnly: true,
      feature: PLAN_FLAG,
      input: z.object({ week: z.enum(['this', 'next']).default('this') }),
      run: (ctx, a) => weekPlan(ctx, a.week),
    },
    {
      name: 'plan_habit_session',
      description: 'Plan sessions of an active habit on a day from today to next Sunday (adds `count`, default 1). A plan is only a plan: a session done on another day of the week still counts.',
      feature: PLAN_FLAG,
      input: z.object({ habit_id: z.string(), day: z.string(), count: z.number().int().min(1).max(MAX_PLANNED).default(1) }),
      run: (ctx, a) => planSession(ctx, a.habit_id, a.day, { add: a.count }),
    },
    {
      name: 'unplan_habit_session',
      description: 'Take planned sessions of a habit off a day (removes `count`, default 1; `all: true` removes every planned session that day). Done sessions are not touched.',
      feature: PLAN_FLAG,
      input: z.object({ habit_id: z.string(), day: z.string(), count: z.number().int().min(1).max(MAX_PLANNED).default(1), all: z.boolean().optional() }),
      run: (ctx, a) => planSession(ctx, a.habit_id, a.day, a.all ? { count: 0 } : { add: -a.count }),
    },
    {
      name: 'schedule_todo',
      description: 'Put a to-do on a day (YYYY-MM-DD) or take it off its day (day null = anytime). Same as update_item on todos with a new day; use add_todo with a day to add one straight into a day.',
      feature: PLAN_FLAG,
      input: z.object({ id: z.string(), day: z.string().nullable() }),
      run: (ctx, a) => scheduleTodo(ctx, a.id, a.day),
    },
    {
      name: 'set_day_lead',
      description:
        'Change what one day of this week or next week is for: a category id, "any" or "away" (null = back to the usual rotation). Only today to next Sunday. Next week’s changes become this week’s when it starts.',
      feature: PLAN_FLAG,
      input: z.object({ day: z.string(), value: z.string().nullable() }),
      run: (ctx, a) => setLead(ctx, a.day, a.value),
    },
  ],
};
