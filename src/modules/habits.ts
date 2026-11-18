// Habits and the habit log.

import { z } from 'zod';
import { addDays, checkDay, type Ctx } from '../core/ctx';
import type { Entity, Row } from '../core/entity';
import { bad } from '../core/errors';
import type { Module } from '../core/registry';
import { create, get, list, remove, update } from '../core/store';

export const HABIT_STATUS = ['active', 'paused', 'ended', 'aspiring'] as const;

export const habitsEntity: Entity = {
  name: 'habits',
  table: 'habits',
  singular: 'habit',
  desc: 'Habits with a target of sessions per day or week. "aspiring" = an idea not started yet.',
  modeScoped: true,
  orderGroup: [],
  filters: ['status', 'category_id', 'per'],
  fields: {
    name: { type: 'text', required: true },
    intention: { type: 'text', desc: 'Free text, e.g. "5 cardio sessions a week" or "just trying it out"' },
    sessions: { type: 'int', desc: 'Target sessions per `per`' },
    per: { type: 'text', enum: ['day', 'week'] },
    size: { type: 'text', desc: 'How big one session is, e.g. "20 minutes"' },
    small_version: { type: 'text', desc: 'The tiny version for a bad day' },
    goal: { type: 'text' },
    step_up_every: { type: 'text', desc: 'How often to consider stepping up, e.g. "2 weeks"' },
    prompts: { type: 'text', desc: 'When or after what to do it' },
    category_id: { type: 'text', ref: 'categories' },
    description: { type: 'markdown' },
    status: { type: 'text', enum: HABIT_STATUS, default: 'active' },
    started: { type: 'day' },
    next_prompt: { type: 'time', desc: 'When to send the next reminder notification' },
  },
  beforeCreate(ctx, row) {
    if (row.status === 'active') row.started ??= ctx.nowDate.toISOString().slice(0, 10);
  },
};

export const habitLogEntity: Entity = {
  name: 'habit_log',
  table: 'habit_log',
  singular: 'habit log entry',
  desc: 'One row per habit, day and kind: done (count = sessions done), plan, skip ("not today").',
  modeScoped: true,
  filters: ['habit_id', 'day', 'kind'],
  sort: 'day DESC',
  fields: {
    habit_id: { type: 'text', required: true, ref: 'habits', cascade: true },
    day: { type: 'day', required: true },
    kind: { type: 'text', enum: ['done', 'plan', 'skip', 'level', 'pending', 'answer'], default: 'done' },
    count: { type: 'int', default: 1 },
    value: { type: 'text' },
  },
};

/** Monday of the week that holds `day`. */
export function mondayOf(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return addDays(day, -((d.getUTCDay() + 6) % 7));
}

/** Set how many sessions of a habit were done on a day (0 removes the entry). */
export async function setHabitCount(ctx: Ctx, habitId: string, day: string, count: number) {
  checkDay(day);
  if (count < 0 || !Number.isInteger(count)) throw bad('count must be a whole number, 0 or more');
  await get(ctx, habitsEntity, habitId);
  const existing = (await list(ctx, habitLogEntity, { where: { habit_id: habitId, day, kind: 'done' } }))[0];
  if (count === 0) {
    if (existing) await remove(ctx, habitLogEntity, existing.id);
    return { habit_id: habitId, day, count: 0 };
  }
  if (existing) return update(ctx, habitLogEntity, existing.id, { count });
  return create(ctx, habitLogEntity, { habit_id: habitId, day, kind: 'done', count });
}

export async function checkHabit(ctx: Ctx, habitId: string, day?: string, add = 1) {
  const d = day ?? (await ctx.today());
  const existing = (await list(ctx, habitLogEntity, { where: { habit_id: habitId, day: d, kind: 'done' } }))[0];
  return setHabitCount(ctx, habitId, d, Math.max(0, Number(existing?.count ?? 0) + add));
}

export interface HabitProgress {
  id: string;
  name: string;
  per: string | null;
  target: number | null;
  done_today: number;
  done_this_period: number;
  skipped_today: boolean;
  left: number;
  small_version: string | null;
}

/** Active habits with how far each is today (per day) or this week (per week). */
export async function habitProgress(ctx: Ctx, day?: string): Promise<HabitProgress[]> {
  const today = day ?? (await ctx.today());
  const monday = mondayOf(today);
  const [habits, logs] = await Promise.all([
    list(ctx, habitsEntity, { where: { status: 'active' } }),
    list(ctx, habitLogEntity, { sql: 'day >= ? AND day <= ?', params: [monday, addDays(monday, 6)], limit: 2000 }),
  ]);
  return habits.map((h: Row) => {
    const mine = logs.filter((l) => l.habit_id === h.id);
    const doneOn = (pred: (d: string) => boolean) =>
      mine.filter((l) => l.kind === 'done' && pred(String(l.day))).reduce((n, l) => n + Number(l.count ?? 0), 0);
    const doneToday = doneOn((d) => d === today);
    const per = (h.per as string | null) ?? 'day';
    const period = per === 'week' ? doneOn(() => true) : doneToday;
    const target = (h.sessions as number | null) ?? null;
    const skipped = mine.some((l) => l.kind === 'skip' && l.day === today);
    return {
      id: h.id,
      name: String(h.name),
      per: (h.per as string | null) ?? null,
      target,
      done_today: doneToday,
      done_this_period: period,
      skipped_today: skipped,
      left: target == null || skipped ? 0 : Math.max(0, target - period),
      small_version: (h.small_version as string | null) ?? null,
    };
  });
}

export const habitsModule: Module = {
  id: 'habits',
  description: 'Habits and their daily log.',
  entities: [habitsEntity, habitLogEntity],
  routes(api) {
    api.get('/habits/progress', async (c) => c.json(await habitProgress(c.get('ctx'), c.req.query('day'))));
    api.post('/habits/:id/check', async (c) => {
      const ctx = c.get('ctx');
      ctx.label = 'check habit';
      const b = await c.req.json<{ day?: string; add?: number; count?: number }>().catch(() => ({}) as Record<string, never>);
      const id = c.req.param('id');
      if (typeof b.count === 'number') return c.json(await setHabitCount(ctx, id, b.day ?? (await ctx.today()), b.count));
      return c.json(await checkHabit(ctx, id, b.day, b.add ?? 1));
    });
  },
  tools: [
    {
      name: 'habit_progress',
      description: 'Active habits with sessions done today / this week and how many are left.',
      readOnly: true,
      input: z.object({ day: z.string().optional() }),
      run: (ctx, a) => habitProgress(ctx, a.day),
    },
    {
      name: 'check_habit',
      description: 'Record sessions of a habit as done (add 1 by default; a negative add removes). day defaults to today.',
      input: z.object({ id: z.string(), day: z.string().optional(), add: z.number().int().default(1) }),
      run: (ctx, a) => checkHabit(ctx, a.id, a.day, a.add),
    },
  ],
};
