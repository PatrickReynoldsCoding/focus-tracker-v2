// The Today list (docs/DECISIONS.md D30, flag `today-panel`): one list of everything for today,
// habits and to-dos together, as v1's "To do today" did. The rules are in src/core/today-list.ts
// (shared with the web app). This module gathers the rows, ticks cards, and gives Claude, the
// widget and the menu bar the same list.

import { z } from 'zod';
import type { Ctx } from '../core/ctx';
import { requireFeature } from '../core/features';
import type { Module } from '../core/registry';
import type { Row } from '../core/entity';
import { buildTodayList, type TodayCardIn, type TodayList, type TodayTodoIn } from '../core/today-list';
import { checkHabit, habitProgress, skipHabit } from './habits';
import { DONE_FLAG, tickCard } from './boards';
import { tickTodo, todosForDay } from './todos';

export const TODAY_LIST_FLAG = 'today-panel';

/** Cards for today or earlier that are not done, and those ticked today, with where they live (a to-do's cards are its to-dos, not cards here). */
export async function cardsForDay(ctx: Ctx, day: string): Promise<TodayCardIn[]> {
  // In the Done column (D34), or with the flag done-column off, in the last of two or more columns (D30).
  const inDone = (await ctx.feature(DONE_FLAG))
    ? '(t.project_id IS NOT NULL AND c.is_done = 1)'
    : `(t.project_id IS NOT NULL
           AND (SELECT COUNT(*) FROM columns x WHERE x.project_id = t.project_id) > 1
           AND NOT EXISTS (SELECT 1 FROM columns x WHERE x.project_id = t.project_id AND (x.ord > c.ord OR (x.ord = c.ord AND x.created > c.created))))`;
  const rows = await ctx.db
    .prepare(
      `SELECT t.id, t.title, t.day, t.done, t.project_id, t.list_id, COALESCE(p.name, l.name) AS owner, ${inDone} AS in_last
       FROM tasks t JOIN columns c ON c.id = t.column_id
       LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN lists l ON l.id = t.list_id
       WHERE t.mode = ? AND t.day IS NOT NULL AND t.day <= ? AND (t.done IS NULL OR t.done = ?) AND (l.kind IS NULL OR l.kind != 'todo')
       ORDER BY t.day, c.ord, t.ord LIMIT 500`,
    )
    .bind(ctx.mode, day, day)
    .all<{ id: string; title: string; day: string; done: string | null; project_id: string | null; list_id: string | null; owner: string | null; in_last: number }>();
  return rows.results.map((r) => ({ id: r.id, title: r.title, day: r.day, done: r.done, project_id: r.project_id, list_id: r.list_id, from: r.owner, in_last: !!r.in_last }));
}

/** The names of the to-do lists after the first (the usual one): a to-do on one of those says which list it is on. */
export async function todoListNames(ctx: Ctx): Promise<Record<string, string>> {
  const r = await ctx.db.prepare("SELECT id, name FROM lists WHERE mode = ? AND kind = 'todo' ORDER BY ord, created").bind(ctx.mode).all<{ id: string; name: string }>();
  return Object.fromEntries(r.results.slice(1).map((l) => [l.id, l.name]));
}

/** Each to-do list that belongs to a project: list id → project id (the Today list's project labels). */
export async function todoListProjects(ctx: Ctx): Promise<Record<string, string>> {
  const r = await ctx.db
    .prepare("SELECT id, project_id FROM lists WHERE mode = ? AND kind = 'todo' AND project_id IS NOT NULL")
    .bind(ctx.mode)
    .all<{ id: string; project_id: string }>();
  return Object.fromEntries(r.results.map((l) => [l.id, l.project_id]));
}

/** To-do rows as the builder reads them, with their list's name when there are several lists. */
export function withListNames(todos: Row[], names: Record<string, string>): TodayTodoIn[] {
  return todos.map((t) => ({
    id: t.id,
    title: String(t.title),
    day: (t.day as string | null) ?? null,
    done: (t.done as string | null) ?? null,
    list_id: (t.list_id as string | null) ?? null,
    list_name: names[String(t.list_id)] ?? null,
    project_id: (t.project_id as string | null) ?? null,
  }));
}

const NOT_TODAY_KEY = 'nottoday';

/** To-dos and cards the owner put off for today ("Not today"): one setting per mode that starts again each day, so they come back tomorrow. */
export async function notTodayKeys(ctx: Ctx, day: string): Promise<string[]> {
  const s = await ctx.jsonSetting<{ day: string; keys: string[] } | null>(NOT_TODAY_KEY, null);
  return s?.day === day ? s.keys : [];
}

/** Put a to-do or card off for today (or back on today's list). Habits have their own skip (habits.ts skipHabit). */
export async function setNotToday(ctx: Ctx, kind: 'todo' | 'card', id: string, on: boolean) {
  const day = await ctx.today();
  const key = `${kind}:${id}`;
  const rest = (await notTodayKeys(ctx, day)).filter((k) => k !== key);
  await ctx.setSetting(NOT_TODAY_KEY, JSON.stringify({ day, keys: on ? [...rest, key] : rest }));
}

/** Everything for today, in one list (GET /api/today/list, Claude's get_today_list, the menu bar). */
export async function todayList(ctx: Ctx): Promise<TodayList> {
  const day = await ctx.today();
  const [habits, todos, cards, names, hide] = await Promise.all([habitProgress(ctx, day), todosForDay(ctx, day), cardsForDay(ctx, day), todoListNames(ctx), notTodayKeys(ctx, day)]);
  return buildTodayList(day, { habits, todos: withListNames(todos, names), cards, hide });
}

export { tickCard };

const KINDS = ['habit', 'todo', 'card'] as const;

/** Claude's tick: a to-do or card done (or not), a habit session (or one off), or a habit put off for today. */
async function tickItem(ctx: Ctx, a: { kind: (typeof KINDS)[number]; id: string; done?: boolean; not_today?: boolean }) {
  const done = a.done !== false;
  if (a.kind === 'habit') {
    if (a.not_today !== undefined) await skipHabit(ctx, a.id, a.not_today);
    else await checkHabit(ctx, a.id, undefined, done ? 1 : -1);
  } else if (a.not_today !== undefined) {
    await setNotToday(ctx, a.kind, a.id, a.not_today);
  } else if (a.kind === 'todo') {
    await tickTodo(ctx, a.id, done);
  } else {
    await tickCard(ctx, a.id, done);
  }
  return todayList(ctx);
}

export const todayListModule: Module = {
  id: 'today-list',
  description: 'The Today list: today’s habits, to-dos and cards in one list, with tick, add and Not today.',
  features: [
    {
      id: TODAY_LIST_FLAG,
      label: 'Today list',
      description:
        'One “Today” panel with everything for today: habits, to-dos and cards for today or left from earlier. It takes the place of To do today and Habits in the Today pill. Off: the separate panels.',
      default: true,
    },
  ],
  routes(api) {
    api.get('/today/list', async (c) => {
      const ctx = c.get('ctx');
      await requireFeature(ctx, TODAY_LIST_FLAG);
      return c.json(await todayList(ctx));
    });
  },
  tools: [
    {
      name: 'get_today_list',
      description:
        'The Today list, as the owner sees it: habits still to do today (or this week), then to-dos and cards for today or left from an earlier day (late), then what was done or put off today. left = how many are still open.',
      readOnly: true,
      feature: TODAY_LIST_FLAG,
      input: z.object({}),
      run: (ctx) => todayList(ctx),
    },
    {
      name: 'tick_today_item',
      description:
        'Tick something in the Today list: a to-do or card done (done false = not done; a project card moves to its board’s Done column, or back to the first), ' +
        'a habit session (done false takes one off), or a habit put off for today (not_today true) or back on today’s list (not_today false). Returns the list.',
      feature: TODAY_LIST_FLAG,
      input: z.object({ kind: z.enum(KINDS), id: z.string(), done: z.boolean().optional(), not_today: z.boolean().optional() }),
      run: (ctx, a) => tickItem(ctx, a),
    },
  ],
};
