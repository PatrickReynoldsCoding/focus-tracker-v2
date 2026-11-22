// Insights: read-only summaries of how the weeks went. No tables of its own.
//
//   week      this week and last week: focus sessions and time, habit sessions against the target, to-dos done
//   habits    per habit, per week: done against the target that applied then (level history), extra shown apart
//   projects  per project in a range: sessions, time, share, last touched, skips
//   logs      the log lines with a project and date filter (editing stays on /log/:id)
//
// Weeks run Monday to Sunday in the owner's time zone (ctx.today()). Every query filters on the mode and on
// a date range, and sums in SQL where it can, so a call reads a few hundred rows at most.
// See docs/DECISIONS.md "D24".

import { z } from 'zod';
import { addDays, type Ctx } from '../core/ctx';
import type { Row } from '../core/entity';
import { bad } from '../core/errors';
import { requireFeature } from '../core/features';
import type { Module } from '../core/registry';
import { list } from '../core/store';
import { formatLevel, levelFromRow, type Level } from '../core/habit-levels';
import { awayForTargets, habitsEntity, levelHistory, levelOn, mondayOf, pauseIntervals, type LevelRow } from './habits';

export const INSIGHTS_FLAG = 'insights';
/** A project not touched for this many days is "stale" (the page shows it in bold). */
export const STALE_DAYS = 14;
const MAX_WEEKS = 26;

// ---------- small helpers ----------

const clampWeeks = (n: unknown, fallback: number): number => {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v >= 1 ? Math.min(v, MAX_WEEKS) : fallback;
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** The Mondays of the `n` weeks ending with the one that holds `today`, oldest first. */
export function weekStarts(today: string, n: number): string[] {
  const last = mondayOf(today);
  return Array.from({ length: n }, (_, i) => addDays(last, -7 * (n - 1 - i)));
}

// ---------- habits against their target ----------

export type WeekStatus =
  /** The week is over and the target was reached. */
  | 'met'
  /** The week is over and the target was not reached. */
  | 'short'
  /** The week is not over yet. */
  | 'open'
  /** The habit started part-way through this week; not counted. */
  | 'partial'
  /** The habit was paused in this week; not counted. */
  | 'paused'
  /** The habit did not exist yet. */
  | 'before';

export interface HabitWeek {
  /** The Monday. */
  week: string;
  /** Sessions done in the week, all of them. */
  done: number;
  /** Sessions that count towards the target (a daily habit counts at most its daily target on each day). */
  counted: number;
  /** Sessions above the target. counted + over = done. */
  over: number;
  target: number;
  status: WeekStatus;
  /** Sessions planned on days after today in this week (only the current week). */
  planned_later: number;
}

interface HabitInput {
  habit: Row;
  history: LevelRow[];
  pauses: { from: string; to: string }[];
  /** done / plan / skip rows of this habit. */
  rows: Row[];
  start: string;
  /** Days that are Away in the rotation (only while the flag away-lowers-targets is on): a daily habit asks nothing then. */
  away?: (day: string) => boolean;
}

/** The day a habit's history starts: `started`, else its first level row, else the day it was created. */
function startOf(habit: Row, history: LevelRow[]): string {
  if (typeof habit.started === 'string' && habit.started) return habit.started;
  if (history[0]) return history[0].day;
  return String(habit.created ?? '').slice(0, 10) || '0000-00-00';
}

/** One week of one habit, against the level that applied then. `today` decides whether the week is over. */
export function habitWeek({ habit, history, pauses, rows, start, away }: HabitInput, monday: string, today: string): HabitWeek {
  const sunday = addDays(monday, 6);
  const mine = rows.filter((r) => String(r.day) >= monday && String(r.day) <= sunday);
  const countOn = (kind: string, day: string) => sum(mine.filter((r) => r.kind === kind && r.day === day).map((r) => Number(r.count ?? 0)));
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const done = sum(days.map((d) => countOn('done', d)));
  const planned_later = sum(days.filter((d) => d > today).map((d) => countOn('plan', d)));

  const level: Level = levelOn(habit, history, monday);
  let counted: number;
  let target: number;
  if (level.per === 'week') {
    target = level.sessions ?? 0;
    counted = Math.min(done, target);
  } else {
    // A daily habit: each day against the level in force on that day; "not today" days and away days (flag away-lowers-targets) ask for nothing.
    target = 0;
    counted = 0;
    for (const d of days) {
      if (d < start) continue;
      const l = levelOn(habit, history, d);
      const asked = countOn('skip', d) > 0 || away?.(d) ? 0 : l.per === 'day' ? (l.sessions ?? 0) : 0;
      target += asked;
      counted += Math.min(countOn('done', d), asked);
    }
  }
  const over = done - counted;

  let status: WeekStatus;
  if (sunday < start) status = 'before';
  else if (pauses.some((p) => p.from <= sunday && p.to >= monday)) status = 'paused';
  else if (sunday >= today) status = 'open';
  else if (start > monday) status = 'partial';
  else status = counted >= target ? 'met' : 'short';
  return { week: monday, done, counted, over, target, status, planned_later: status === 'open' ? planned_later : 0 };
}

interface HabitData {
  habits: { habit: Row; input: HabitInput }[];
}

/** The habits (active and paused) with their level history, pauses and the done / plan / skip rows from `from`. */
async function loadHabits(ctx: Ctx, from: string, to: string, today: string): Promise<HabitData> {
  const [habits, logs, meta, away] = await Promise.all([
    list(ctx, habitsEntity, { sql: "status IN ('active', 'paused')", limit: 500 }),
    ctx.db
      .prepare("SELECT habit_id, day, kind, count FROM habit_log WHERE mode = ? AND day >= ? AND day <= ? AND kind IN ('done', 'plan', 'skip') LIMIT 5000")
      .bind(ctx.mode, from, to)
      .all<Row>(),
    ctx.db
      .prepare("SELECT habit_id, day, kind, count, value FROM habit_log WHERE mode = ? AND kind IN ('level', 'pause', 'resume') ORDER BY day LIMIT 2000")
      .bind(ctx.mode)
      .all<Row>(),
    awayForTargets(ctx),
  ]);
  return {
    habits: habits.map((habit) => {
      const history = levelHistory(habit, meta.results);
      const mineMeta = meta.results.filter((m) => m.habit_id === habit.id);
      return {
        habit,
        input: {
          habit,
          history,
          pauses: pauseIntervals(mineMeta, today),
          rows: logs.results.filter((l) => l.habit_id === habit.id),
          start: startOf(habit, history),
          away,
        },
      };
    }),
  };
}

const levelText = (habit: Row, history: LevelRow[], day: string): string => formatLevel(levelOn(habit, history, day));

// ---------- week ----------

export interface WeekSummary {
  start: string;
  end: string;
  current: boolean;
  focus: { sessions: number; minutes: number; days: { day: string; sessions: number; minutes: number }[] };
  habits: (HabitWeek & { id: string; name: string; per: string; level: string })[];
  habit_totals: { counted: number; target: number; over: number };
  todos: { done: number; still_open: number; coming_up: number };
  skips: number;
}

/** This week and last week at a glance. */
export async function weekSummary(ctx: Ctx): Promise<{ today: string; weeks: WeekSummary[] }> {
  const today = await ctx.today();
  const thisWeek = mondayOf(today);
  const lastWeek = addDays(thisWeek, -7);
  const to = addDays(thisWeek, 6);
  const [data, logs, todosDone, todosOpen, skips] = await Promise.all([
    loadHabits(ctx, lastWeek, to, today),
    ctx.db
      .prepare('SELECT date AS day, COUNT(*) AS sessions, COALESCE(SUM(minutes), 0) AS minutes FROM log WHERE mode = ? AND date >= ? AND date <= ? GROUP BY date')
      .bind(ctx.mode, lastWeek, to)
      .all<{ day: string; sessions: number; minutes: number }>(),
    ctx.db
      .prepare(`SELECT t.done AS day, COUNT(*) AS n FROM tasks t JOIN lists l ON l.id = t.list_id AND l.kind = 'todo'
                WHERE t.mode = ? AND t.done >= ? AND t.done <= ? GROUP BY t.done`)
      .bind(ctx.mode, lastWeek, to)
      .all<{ day: string; n: number }>(),
    ctx.db
      .prepare(`SELECT t.day, COUNT(*) AS n FROM tasks t JOIN lists l ON l.id = t.list_id AND l.kind = 'todo'
                WHERE t.mode = ? AND t.done IS NULL AND t.day >= ? AND t.day <= ? GROUP BY t.day`)
      .bind(ctx.mode, lastWeek, to)
      .all<{ day: string; n: number }>(),
    ctx.db
      .prepare('SELECT date AS day, COUNT(*) AS n FROM skips WHERE mode = ? AND date >= ? AND date <= ? GROUP BY date')
      .bind(ctx.mode, lastWeek, to)
      .all<{ day: string; n: number }>(),
  ]);
  const weeks = [thisWeek, lastWeek].map((monday): WeekSummary => {
    const end = addDays(monday, 6);
    const inWeek = (d: string) => d >= monday && d <= end;
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i)).map((day) => {
      const r = logs.results.find((x) => x.day === day);
      return { day, sessions: r?.sessions ?? 0, minutes: r?.minutes ?? 0 };
    });
    const habits = data.habits
      .map(({ habit, input }) => ({ habit, input, w: habitWeek(input, monday, today) }))
      .filter((x) => x.w.status !== 'before')
      .map(({ habit, input, w }) => ({ ...w, id: String(habit.id), name: String(habit.name), per: String(levelOn(habit, input.history, monday).per), level: levelText(habit, input.history, monday) }));
    const counting = habits.filter((h) => h.status !== 'paused');
    return {
      start: monday,
      end,
      current: monday === thisWeek,
      focus: { sessions: sum(days.map((d) => d.sessions)), minutes: sum(days.map((d) => d.minutes)), days },
      habits,
      habit_totals: { counted: sum(counting.map((h) => h.counted)), target: sum(counting.map((h) => h.target)), over: sum(counting.map((h) => h.over)) },
      todos: {
        done: sum(todosDone.results.filter((r) => inWeek(r.day)).map((r) => r.n)),
        still_open: sum(todosOpen.results.filter((r) => inWeek(r.day) && r.day <= today).map((r) => r.n)),
        coming_up: sum(todosOpen.results.filter((r) => inWeek(r.day) && r.day > today).map((r) => r.n)),
      },
      skips: sum(skips.results.filter((r) => inWeek(r.day)).map((r) => r.n)),
    };
  });
  return { today, weeks };
}

// ---------- habits ----------

export interface HabitHistory {
  id: string;
  name: string;
  status: string;
  per: string;
  /** The level in force now, as text. */
  level: string;
  weeks: (HabitWeek & { level: string })[];
  /** Weeks that were over, not paused and after the habit started. */
  counted_weeks: number;
  on_target_weeks: number;
}

export async function habitsHistory(ctx: Ctx, weeksBack: number): Promise<{ today: string; weeks: string[]; habits: HabitHistory[] }> {
  const today = await ctx.today();
  const starts = weekStarts(today, weeksBack);
  const data = await loadHabits(ctx, starts[0], addDays(starts[starts.length - 1], 6), today);
  const habits = data.habits.map(({ habit, input }): HabitHistory => {
    const weeks = starts.map((w) => ({ ...habitWeek(input, w, today), level: levelText(habit, input.history, w) }));
    const counted = weeks.filter((w) => w.status === 'met' || w.status === 'short');
    return {
      id: String(habit.id),
      name: String(habit.name),
      status: String(habit.status),
      per: String(levelFromRow(habit).per),
      level: levelText(habit, input.history, today),
      weeks,
      counted_weeks: counted.length,
      on_target_weeks: counted.filter((w) => w.status === 'met').length,
    };
  });
  return { today, weeks: starts, habits };
}

// ---------- projects ----------

export interface ProjectInsight {
  id: string | null;
  name: string;
  status: string;
  sessions: number;
  minutes: number;
  /** Share of all minutes in the range, 0 to 1. */
  share: number;
  last_touched: string | null;
  days_since: number | null;
  stale: boolean;
  skips: number;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

export async function projectsInsight(ctx: Ctx, weeksBack: number) {
  const today = await ctx.today();
  const from = weekStarts(today, weeksBack)[0];
  const [logs, skips, projects] = await Promise.all([
    ctx.db
      .prepare('SELECT project_id, COUNT(*) AS sessions, COALESCE(SUM(minutes), 0) AS minutes FROM log WHERE mode = ? AND date >= ? AND date <= ? GROUP BY project_id')
      .bind(ctx.mode, from, today)
      .all<{ project_id: string | null; sessions: number; minutes: number }>(),
    ctx.db
      .prepare('SELECT project_id, COUNT(*) AS n FROM skips WHERE mode = ? AND date >= ? AND date <= ? GROUP BY project_id')
      .bind(ctx.mode, from, today)
      .all<{ project_id: string; n: number }>(),
    ctx.db.prepare('SELECT id, name, status, last_touched FROM projects WHERE mode = ?').bind(ctx.mode).all<{ id: string; name: string; status: string; last_touched: string | null }>(),
  ]);
  const totalMinutes = sum(logs.results.map((l) => l.minutes));
  const rows: ProjectInsight[] = [];
  for (const p of projects.results) {
    const l = logs.results.find((x) => x.project_id === p.id);
    const s = skips.results.find((x) => x.project_id === p.id)?.n ?? 0;
    if (p.status !== 'active' && !l && !s) continue;
    const since = p.last_touched ? daysBetween(p.last_touched, today) : null;
    rows.push({
      id: p.id,
      name: p.name,
      status: p.status,
      sessions: l?.sessions ?? 0,
      minutes: l?.minutes ?? 0,
      share: totalMinutes ? (l?.minutes ?? 0) / totalMinutes : 0,
      last_touched: p.last_touched,
      days_since: since,
      stale: p.status === 'active' && (since == null || since > STALE_DAYS),
      skips: s,
    });
  }
  const loose = logs.results.find((l) => l.project_id == null);
  if (loose) {
    rows.push({ id: null, name: 'No project', status: 'active', sessions: loose.sessions, minutes: loose.minutes, share: totalMinutes ? loose.minutes / totalMinutes : 0, last_touched: null, days_since: null, stale: false, skips: 0 });
  }
  rows.sort((a, b) => b.minutes - a.minutes || b.sessions - a.sessions || a.name.localeCompare(b.name));
  return {
    today,
    from,
    weeks: weeksBack,
    total_sessions: sum(logs.results.map((l) => l.sessions)),
    total_minutes: totalMinutes,
    total_skips: sum(skips.results.map((s) => s.n)),
    projects: rows,
  };
}

// ---------- logs ----------

export async function logLines(ctx: Ctx, q: { project?: string; from?: string; to?: string; limit?: number; offset?: number }) {
  const cond = ['l.mode = ?'];
  const params: unknown[] = [ctx.mode];
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (q.project === 'none') cond.push('l.project_id IS NULL');
  else if (q.project) (cond.push('l.project_id = ?'), params.push(q.project));
  if (q.from) {
    if (!day.test(q.from)) throw bad('from must be a date like 2026-11-18');
    cond.push('l.date >= ?');
    params.push(q.from);
  }
  if (q.to) {
    if (!day.test(q.to)) throw bad('to must be a date like 2026-11-18');
    cond.push('l.date <= ?');
    params.push(q.to);
  }
  const limit = Math.min(Math.max(Math.floor(q.limit ?? 100), 1), 200);
  const where = cond.join(' AND ');
  const [rows, total] = await Promise.all([
    ctx.db
      .prepare(
        `SELECT l.id, l.date, l.project_id, p.name AS project_name, l.minutes, l.where_stopped FROM log l LEFT JOIN projects p ON p.id = l.project_id AND p.mode = l.mode WHERE ${where} ORDER BY l.date DESC, l.created DESC LIMIT ? OFFSET ?`,
      )
      .bind(...params, limit + 1, Math.max(0, Math.floor(q.offset ?? 0)))
      .all<Row>(),
    ctx.db.prepare(`SELECT COUNT(*) AS sessions, COALESCE(SUM(minutes), 0) AS minutes FROM log l WHERE ${where}`).bind(...params).first<{ sessions: number; minutes: number }>(),
  ]);
  return { rows: rows.results.slice(0, limit), has_more: rows.results.length > limit, sessions: total?.sessions ?? 0, minutes: total?.minutes ?? 0 };
}

// ---------- the module ----------

export const insightsModule: Module = {
  id: 'insights',
  description: 'Insights: how the weeks went (focus time, habits against target, to-dos, projects). Read only.',
  features: [
    {
      id: INSIGHTS_FLAG,
      label: 'Insights tab',
      description: 'The Log tab becomes Insights: Week, Habits, Projects and Logs. Off: the plain Log list comes back.',
      default: true,
    },
  ],
  routes(api) {
    const on = async (c: { get(k: 'ctx'): Ctx }) => {
      const ctx = c.get('ctx');
      await requireFeature(ctx, INSIGHTS_FLAG);
      return ctx;
    };
    api.get('/insights/week', async (c) => c.json(await weekSummary(await on(c))));
    api.get('/insights/habits', async (c) => c.json(await habitsHistory(await on(c), clampWeeks(c.req.query('weeks'), 8))));
    api.get('/insights/projects', async (c) => c.json(await projectsInsight(await on(c), clampWeeks(c.req.query('weeks'), 4))));
    api.get('/insights/logs', async (c) => {
      const ctx = await on(c);
      const q = c.req.query();
      return c.json(await logLines(ctx, { project: q.project, from: q.from, to: q.to, limit: q.limit ? Number(q.limit) : undefined, offset: q.offset ? Number(q.offset) : undefined }));
    });
  },
  tools: [
    {
      name: 'insights',
      description:
        'How the weeks went. view "week": this week and last week (focus sessions and minutes per day, habit sessions done against the target that applied, to-dos done, skips). ' +
        'view "projects": per project in the last `weeks` weeks (default 4): sessions, minutes, share, last touched, skips. ' +
        'view "habits": per habit, per week for the last `weeks` weeks (default 8): done, counted towards the target, over, target, status (met, short, open, partial, paused, before) and "on target n of m weeks". Weeks run Monday to Sunday.',
      readOnly: true,
      feature: INSIGHTS_FLAG,
      input: z.object({ view: z.enum(['week', 'projects', 'habits']).default('week'), weeks: z.number().int().min(1).max(MAX_WEEKS).optional() }),
      run: (ctx, a) =>
        a.view === 'projects' ? projectsInsight(ctx, clampWeeks(a.weeks, 4)) : a.view === 'habits' ? habitsHistory(ctx, clampWeeks(a.weeks, 8)) : weekSummary(ctx),
    },
  ],
};
