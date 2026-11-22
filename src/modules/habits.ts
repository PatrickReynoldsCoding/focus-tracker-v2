// Habits, their daily log, level history and step-up prompts.
//
// A habit's level is "how much, how often" (sessions per day or week, and a size).
// The habit row always holds the level in force now. Everything that happens to it over
// time is in habit_log (one row per habit, day and kind):
//   done     sessions done on that day (count)
//   plan / skip   planned sessions, "not today"
//   level    a level took effect on `day` (value "3 a week, 30 min"); the target of past weeks is read from here
//   pending  a level change waiting for the owner's Accept; `day` is when it falls due
//   answer   the owner's answer to a step-up prompt (value yes / not now / at goal / stop asking / keep asking)
//   pause / resume   the habit was paused or resumed on that day (weeks that overlap a pause are left out of step-up maths)
// See docs/DECISIONS.md "D22" for why it is built this way.

import { z } from 'zod';
import { addDays, checkDay, type Ctx } from '../core/ctx';
import type { Entity, Row } from '../core/entity';
import { bad } from '../core/errors';
import { requireFeature } from '../core/features';
import type { Module } from '../core/registry';
import { create, get, list, remove, removeWhere, update } from '../core/store';
import { awayLookup, mondayOf } from '../core/rotation';
import { formatLevel, levelFromRow, nextSteps, parseEvery, parseLevel, weekTarget, type Level, type Step } from '../core/habit-levels';

export const HABIT_STATUS = ['active', 'paused', 'ended', 'aspiring'] as const;
/** The whole Habits feature: tab, panels, Today list, notifications, Insights and Plan my week parts, routes and Claude's tools. Data stays while off. */
export const HABITS_FLAG = 'habits';
export const STEP_UP_FLAG = 'habit-step-up';
/** Away days in the rotation ask nothing of a daily habit (step-up maths, Insights, Plan my week). */
export const AWAY_FLAG = 'away-lowers-targets';
/** A step-up needs this share of the target sessions done in the full weeks since the level changed. */
export const MET_SHARE = 0.8;
/** At most this many full weeks are looked at, newest first (keeps the query small). */
const MAX_WEEKS = 12;

export const habitsEntity: Entity = {
  name: 'habits',
  table: 'habits',
  singular: 'habit',
  desc:
    'Habits with a target of sessions per day or week. status "aspiring" = an idea not started yet (a name and a note, nothing else). ' +
    'The row holds the level in force now; changing sessions, per or size writes a level row in the habit log and drops a waiting level change. ' +
    'Changing status to paused or active is recorded, so paused weeks do not count against a step-up.',
  modeScoped: true,
  feature: HABITS_FLAG,
  orderGroup: [],
  filters: ['status', 'category_id', 'per', 'project_id'],
  fields: {
    name: { type: 'text', required: true },
    intention: { type: 'text', desc: 'Free text, the why: "so I can climb stairs without puffing"' },
    sessions: { type: 'int', desc: 'Target sessions per `per` (the level in force now)' },
    per: { type: 'text', enum: ['day', 'week'] },
    size: { type: 'text', desc: 'How big one session is, a number and a unit: "20 min", "2 km". Step-ups grow it.' },
    small_version: { type: 'text', desc: 'The tiny version for a bad day (counts as a session)' },
    goal: { type: 'text', desc: 'Where the ramp-up stops, like a level: "5 a week, 45 min". Step-ups never go past it.' },
    step_up_every: { type: 'text', desc: 'How often to consider stepping up: "1 week", "2 weeks", "3 weeks", "4 weeks". Empty = never ask.' },
    prompts: { type: 'text', desc: 'Step-up prompts: "on", "off" or "at goal" (set when the owner says they are at their goal)' },
    category_id: { type: 'text', ref: 'categories' },
    project_id: { type: 'text', ref: 'projects', desc: 'The one project this habit belongs to (empty: none). The habit then also shows on that project’s page.' },
    description: { type: 'markdown', desc: 'The why and any anchor: "after coffee"' },
    notes: { type: 'markdown', desc: 'The habit’s notes: anything useful for doing it (Markdown). Shown at the top of the habit’s dialog in the app.' },
    status: { type: 'text', enum: HABIT_STATUS, default: 'active' },
    started: { type: 'day' },
    next_prompt: { type: 'time', desc: 'When the next step-up prompt falls due (the app sets it)' },
  },
  async beforeCreate(ctx, row) {
    const today = await ctx.today();
    if (row.status === 'active') row.started ??= today;
    if (row.status !== 'aspiring') await setPromptDue(ctx, row, today);
  },
  async afterCreate(ctx, row) {
    if (row.status !== 'active') return;
    const level = levelFromRow(row);
    if (level.sessions == null) return;
    await writeLevel(ctx, row.id, periodStart(level.per, String(row.started ?? (await ctx.today()))), level);
  },
  async beforeUpdate(ctx, before, patch) {
    const today = await ctx.today();
    const after = { ...before, ...patch } as Record<string, unknown>;
    const wasStatus = before.status as string;
    const status = after.status as string;
    const starting = wasStatus === 'aspiring' && status === 'active';
    if (starting && !after.started) patch.started = after.started = today;
    if (patch.status && patch.status !== wasStatus) {
      if (status === 'paused') await upsertLog(ctx, before.id, today, 'pause', 1, null);
      if (wasStatus === 'paused' && status === 'active') await upsertLog(ctx, before.id, today, 'resume', 1, null);
    }
    if (status === 'active' || status === 'paused') {
      const was = formatLevel(levelFromRow(before));
      const level = levelFromRow(after);
      if (level.sessions != null && (starting || was !== formatLevel(level))) {
        await writeLevel(ctx, before.id, periodStart(level.per, today), level);
        await removeWhere(ctx, habitLogEntity, { habit_id: before.id, kind: 'pending' });
      }
    }
    if (status === 'active' && (starting || after.next_prompt == null)) {
      const withDue = { ...after };
      await setPromptDue(ctx, withDue, today);
      if (withDue.next_prompt != null && withDue.next_prompt !== after.next_prompt) patch.next_prompt = withDue.next_prompt;
    }
  },
};

export const habitLogEntity: Entity = {
  name: 'habit_log',
  table: 'habit_log',
  singular: 'habit log entry',
  desc:
    'One row per habit, day and kind: done (count = sessions done), plan, skip ("not today"), ' +
    'level (a level took effect on that day; value "3 a week, 30 min"), pending (a level change waiting for the owner to accept), ' +
    'answer (answer to a step-up prompt), pause, resume.',
  modeScoped: true,
  feature: HABITS_FLAG,
  filters: ['habit_id', 'day', 'kind'],
  sort: 'day DESC',
  fields: {
    habit_id: { type: 'text', required: true, ref: 'habits', cascade: true },
    day: { type: 'day', required: true },
    kind: { type: 'text', enum: ['done', 'plan', 'skip', 'level', 'pending', 'answer', 'pause', 'resume'], default: 'done' },
    count: { type: 'int', default: 1 },
    value: { type: 'text' },
  },
};

// ---------- dates and small helpers ----------

/** Monday of the week that holds `day` (kept here too for the modules that import it from habits). */
export { mondayOf };

/** First day of the period a day is in: the Monday for weekly habits, the day itself for daily ones. */
export const periodStart = (per: string, day: string): string => (per === 'week' ? mondayOf(day) : day);

/** When a level change falls due: next Monday for weekly habits, tomorrow for daily ones. */
export const dueDayFor = (per: string, today: string): string => (per === 'week' ? addDays(mondayOf(today), 7) : addDays(today, 1));

async function upsertLog(ctx: Ctx, habitId: string, day: string, kind: string, count: number, value: string | null) {
  const existing = (await list(ctx, habitLogEntity, { where: { habit_id: habitId, day, kind }, limit: 1 }))[0];
  if (existing) return update(ctx, habitLogEntity, existing.id, { count, value });
  return create(ctx, habitLogEntity, { habit_id: habitId, day, kind, count, value });
}

const writeLevel = (ctx: Ctx, habitId: string, day: string, level: Level) => upsertLog(ctx, habitId, day, 'level', level.sessions ?? 1, formatLevel(level));

/** Set next_prompt for a habit that can be prompted and has none (a row as it goes to the database). */
async function setPromptDue(ctx: Ctx, row: Record<string, unknown>, today: string) {
  if (row.next_prompt != null) return;
  const every = parseEvery(row.step_up_every as string | null);
  if (!every || row.prompts === 'off' || row.prompts === 'at goal' || !row.goal) return;
  row.prompts ??= 'on';
  row.next_prompt = `${addDays(today, every)}T00:00:00.000Z`;
}

async function checkRecordDay(ctx: Ctx, day: string): Promise<string> {
  checkDay(day);
  const today = await ctx.today();
  if (day > today) throw bad('That day has not happened yet');
  if (day < addDays(today, -7)) throw bad('Only today and the 7 days before it can be changed');
  return day;
}

// ---------- the log ----------

/** Set how many sessions of a habit were done on a day (0 removes the entry). */
export async function setHabitCount(ctx: Ctx, habitId: string, day: string, count: number) {
  await checkRecordDay(ctx, day);
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
  await checkRecordDay(ctx, d);
  const existing = (await list(ctx, habitLogEntity, { where: { habit_id: habitId, day: d, kind: 'done' } }))[0];
  return setHabitCount(ctx, habitId, d, Math.max(0, Number(existing?.count ?? 0) + add));
}

/** "Not today" (on) or back on today's list (off): a skip row for the day. A skipped habit asks nothing that day. */
export async function skipHabit(ctx: Ctx, habitId: string, on: boolean, day?: string) {
  const d = await checkRecordDay(ctx, day ?? (await ctx.today()));
  await get(ctx, habitsEntity, habitId);
  if (on) await upsertLog(ctx, habitId, d, 'skip', 1, null);
  else await removeWhere(ctx, habitLogEntity, { habit_id: habitId, day: d, kind: 'skip' });
  return { habit_id: habitId, day: d, skipped: on };
}

// ---------- level history ----------

export interface LevelRow {
  day: string;
  level: Level;
}

/** A habit's level rows, oldest first. `habit` gives the "per" when the value does not name one. */
export function levelHistory(habit: Row, logs: Row[]): LevelRow[] {
  const out: LevelRow[] = [];
  const fallbackPer = habit.per === 'week' ? 'week' : 'day';
  for (const l of logs) {
    if (l.habit_id !== habit.id || l.kind !== 'level') continue;
    const level = parseLevel(l.value as string | null, fallbackPer) ?? (typeof l.count === 'number' && l.count > 0 ? { ...levelFromRow(habit), sessions: l.count } : null);
    if (level) out.push({ day: String(l.day), level });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * The level that applied on `day` (for a weekly habit pass the Monday of the week):
 * the latest level row on or before it; before the first row, the first row; with no rows, the habit row itself.
 */
export function levelOn(habit: Row, history: LevelRow[], day: string): Level {
  let found: LevelRow | undefined;
  for (const h of history) if (h.day <= day) found = h;
  return (found ?? history[0])?.level ?? levelFromRow(habit);
}

/** The target in force for a period that holds `day`. */
export function levelForDay(habit: Row, history: LevelRow[], day: string): Level {
  return levelOn(habit, history, periodStart(habit.per === 'week' ? 'week' : 'day', day));
}

// ---------- step-up eligibility ----------

export interface WeeksMet {
  /** Full weeks that counted. */
  weeks: number;
  /** Sessions done in them, each day (or week) capped at its target. */
  done: number;
  target: number;
}

/** Monday-to-Sunday weeks (Mondays) that are over, started on or after `since`, newest MAX_WEEKS at most, and not touched by a pause. */
export function fullWeeks(since: string, today: string, pauses: { from: string; to: string }[]): string[] {
  const first = mondayOf(since) === since ? since : addDays(mondayOf(since), 7);
  const last = addDays(mondayOf(today), -7);
  const out: string[] = [];
  for (let w = last; w >= first && out.length < MAX_WEEKS; w = addDays(w, -7)) {
    const end = addDays(w, 6);
    if (pauses.some((p) => p.from <= end && p.to >= w)) continue;
    out.push(w);
  }
  return out.reverse();
}

/** Pause intervals (inclusive days) from pause and resume rows; an open pause runs to `today`. */
export function pauseIntervals(rows: Row[], today: string): { from: string; to: string }[] {
  const sorted = rows.filter((r) => r.kind === 'pause' || r.kind === 'resume').sort((a, b) => String(a.day).localeCompare(String(b.day)) || (a.kind === 'pause' ? -1 : 1));
  const out: { from: string; to: string }[] = [];
  let open: string | null = null;
  for (const r of sorted) {
    if (r.kind === 'pause' && open == null) open = String(r.day);
    else if (r.kind === 'resume' && open != null) {
      if (String(r.day) > open) out.push({ from: open, to: addDays(String(r.day), -1) });
      open = null;
    }
  }
  if (open != null) out.push({ from: open, to: today });
  return out;
}

/**
 * How much of the target was done in the full weeks since the level last changed (paused weeks left out).
 * With `away` (flag away-lowers-targets), a daily habit asks nothing on an away day: that day is left out of
 * the target, and sessions done on it are extra (they do not count towards the target).
 */
export function weeksMet(level: Level, weeks: string[], done: Row[], away?: (day: string) => boolean): WeeksMet {
  const per = level.per;
  const sessions = level.sessions ?? 0;
  let doneSum = 0;
  let target = 0;
  for (const w of weeks) {
    const days = new Map<string, number>();
    for (const l of done) {
      if (l.kind !== 'done' || String(l.day) < w || String(l.day) > addDays(w, 6)) continue;
      days.set(String(l.day), (days.get(String(l.day)) ?? 0) + Number(l.count ?? 0));
    }
    if (per === 'day') {
      const awayDays = away ? Array.from({ length: 7 }, (_, i) => addDays(w, i)).filter(away) : [];
      target += (7 - awayDays.length) * sessions;
      for (const [d, c] of days) if (!awayDays.includes(d)) doneSum += Math.min(c, sessions);
    } else {
      target += weekTarget(level);
      doneSum += Math.min([...days.values()].reduce((n, c) => n + c, 0), sessions);
    }
  }
  return { weeks: weeks.length, done: doneSum, target };
}

/** The away-day lookup when the flag away-lowers-targets is on, else undefined (nothing is away). */
export async function awayForTargets(ctx: Ctx): Promise<((day: string) => boolean) | undefined> {
  return (await ctx.feature(AWAY_FLAG)) ? awayLookup(ctx) : undefined;
}

export const isMet = (m: WeeksMet) => m.weeks > 0 && m.target > 0 && m.done >= m.target * MET_SHARE - 1e-9;

export interface StepUp {
  options: { kind: 'sessions' | 'size'; text: string; sessions: number | null; size: string | null }[];
  suggested: number;
  current: string;
  goal: string;
  weeks: WeeksMet;
  /** The last three answers were all "not now": ask whether to stop asking. */
  ask_stop: boolean;
}

const optionOf = (s: Step) => ({ kind: s.kind, text: s.text, sessions: s.level.sessions, size: s.level.size == null ? null : `${s.level.size}${s.level.unit ? ` ${s.level.unit}` : ''}` });

function goalOf(h: Row): Level | null {
  return parseLevel(h.goal as string | null, h.per === 'week' ? 'week' : 'day');
}

/** The steps the owner can take now, or null when the habit has no goal or is at it. */
export function stepOptions(h: Row, current: Level) {
  const goal = goalOf(h);
  if (!goal) return null;
  const steps = nextSteps(current, { ...goal, per: current.per });
  return steps.options.length ? { ...steps, goal } : null;
}

function notNowStreak(answers: Row[]): number {
  let n = 0;
  for (const a of [...answers].sort((x, y) => String(y.day).localeCompare(String(x.day)))) {
    if (a.value !== 'not now') break;
    n++;
  }
  return n;
}

// ---------- progress ----------

export interface Pending {
  day: string;
  text: string;
  /** The day it falls due has come: Today shows Accept / Not yet. */
  due: boolean;
}

export interface HabitProgress {
  id: string;
  /** The day this progress is for (today unless asked for another). */
  day: string;
  name: string;
  per: string | null;
  target: number | null;
  done_today: number;
  done_this_period: number;
  skipped_today: boolean;
  left: number;
  small_version: string | null;
  /** The habit's notes (Markdown), null when it has none. */
  notes: string | null;
  /** The level that applies to this period, as text: "3 a week, 30 min". */
  level: string;
  size: string | null;
  goal: string | null;
  /** The days the dots can be tapped on: this week (weekly habits) or the last 7 days (daily ones). planned: sessions planned that day (Plan my week). */
  days: { day: string; count: number; future: boolean; planned: number }[];
  /** Sessions planned for this day in Plan my week. */
  planned_today: number;
  /** Sessions planned on the days after this one, to the end of the week (Monday to Sunday). */
  planned_later: number;
  pending: Pending | null;
  step_up: StepUp | null;
  /** Three "not now" in a row: ask "Stop asking about this habit?" */
  ask_stop: boolean;
}

/** Active habits with how far each is today (per day) or this week (per week), against the level that applied then. */
export async function habitProgress(ctx: Ctx, day?: string): Promise<HabitProgress[]> {
  const real = await ctx.today();
  const asOf = day ?? real;
  const monday = mondayOf(asOf);
  const stripFrom = addDays(asOf, -6);
  const from = stripFrom < monday ? stripFrom : monday;
  const [habits, logs, meta] = await Promise.all([
    list(ctx, habitsEntity, { where: { status: 'active' } }),
    list(ctx, habitLogEntity, { sql: 'day >= ? AND day <= ? AND kind IN (?, ?)', params: [from, addDays(monday, 6), 'done', 'skip'], limit: 2000 }).then(async (rows) => [
      ...rows,
      ...(await list(ctx, habitLogEntity, { where: { kind: 'plan' }, sql: 'day >= ? AND day <= ?', params: [monday, addDays(monday, 6)], limit: 2000 })),
    ]),
    list(ctx, habitLogEntity, { sql: 'kind IN (?, ?, ?, ?)', params: ['level', 'pending', 'pause', 'resume'], order: 'day', limit: 2000 }),
  ]);
  const stepUps = asOf === real && habits.length ? await stepUpsFor(ctx, habits, meta, real) : new Map<string, StepUp>();
  const askStop = new Set<string>();
  for (const [id, s] of stepUps) if (s.ask_stop) askStop.add(id);
  return habits.map((h: Row) => {
    const mine = logs.filter((l) => l.habit_id === h.id);
    const countOf = (kind: string, pred: (d: string) => boolean) => mine.filter((l) => l.kind === kind && pred(String(l.day))).reduce((n, l) => n + Number(l.count ?? 0), 0);
    const doneOn = (pred: (d: string) => boolean) => countOf('done', pred);
    const plannedOn = (pred: (d: string) => boolean) => countOf('plan', pred);
    const per = (h.per as string | null) ?? 'day';
    const level = levelForDay(h, levelHistory(h, meta), asOf);
    const doneToday = doneOn((d) => d === asOf);
    const period = per === 'week' ? doneOn(() => true) : doneToday;
    const target = level.sessions;
    const skipped = mine.some((l) => l.kind === 'skip' && l.day === asOf);
    const first = per === 'week' ? monday : stripFrom;
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(first, i);
      return { day: d, count: doneOn((x) => x === d), future: d > real, planned: plannedOn((x) => x === d) };
    });
    const pend = meta.find((m) => m.habit_id === h.id && m.kind === 'pending');
    const su = stepUps.get(h.id as string) ?? null;
    return {
      id: h.id,
      day: asOf,
      name: String(h.name),
      project_id: (h.project_id as string | null) ?? null,
      per: (h.per as string | null) ?? null,
      target,
      done_today: doneToday,
      done_this_period: period,
      skipped_today: skipped,
      left: target == null || skipped ? 0 : Math.max(0, target - period),
      small_version: (h.small_version as string | null) ?? null,
      notes: (h.notes as string | null) || null,
      level: formatLevel(level),
      size: level.size == null ? null : formatLevel({ ...level, sessions: null }),
      goal: (h.goal as string | null) ?? null,
      days,
      planned_today: plannedOn((d) => d === asOf),
      planned_later: plannedOn((d) => d > asOf),
      pending: pend ? { day: String(pend.day), text: String(pend.value ?? ''), due: String(pend.day) <= real } : null,
      step_up: su && !su.ask_stop ? su : null,
      ask_stop: askStop.has(h.id as string),
    };
  });
}

/**
 * Habits whose step-up prompt is due. Only the first (in the owner's order) gets a card, and none once a prompt
 * was answered today. A habit that earned the question "Stop asking?" is flagged with ask_stop instead.
 */
async function stepUpsFor(ctx: Ctx, habits: Row[], meta: Row[], today: string): Promise<Map<string, StepUp>> {
  const out = new Map<string, StepUp>();
  if (!(await ctx.feature(STEP_UP_FLAG))) return out;
  const askable = habits.filter((h) => h.prompts !== 'off' && h.prompts !== 'at goal');
  if (!askable.length) return out;
  const answers = await list(ctx, habitLogEntity, { where: { kind: 'answer' }, sql: 'day >= ?', params: [addDays(today, -200)], limit: 2000 });
  const away = await awayForTargets(ctx);
  const answeredToday = answers.some((a) => a.day === today && ['yes', 'not now', 'at goal'].includes(String(a.value)));
  let cardGiven = answeredToday;
  for (const h of askable) {
    const history = levelHistory(h, meta);
    const level = levelForDay(h, history, today);
    const mineAnswers = answers.filter((a) => a.habit_id === h.id);
    const options = stepOptions(h, level);
    if (!options) continue;
    const waiting = meta.some((m) => m.habit_id === h.id && m.kind === 'pending');
    const askStop = notNowStreak(mineAnswers) >= 3;
    const due = h.next_prompt != null && String(h.next_prompt).slice(0, 10) <= today;
    if (!askStop && (waiting || !due || cardGiven)) continue;
    const since = history.length ? history[history.length - 1].day : String(h.started ?? h.created).slice(0, 10);
    const weeks = fullWeeks(since, today, pauseIntervals(meta.filter((m) => m.habit_id === h.id), today));
    let met: WeeksMet = weeksMet(level, weeks, [], away);
    if (weeks.length) {
      const done = await list(ctx, habitLogEntity, { where: { habit_id: h.id, kind: 'done' }, sql: 'day >= ? AND day <= ?', params: [weeks[0], addDays(weeks[weeks.length - 1], 6)], limit: 2000 });
      met = weeksMet(level, weeks, done, away);
    }
    if (!askStop && !isMet(met)) continue;
    out.set(h.id, {
      options: options.options.map(optionOf),
      suggested: options.suggested,
      current: formatLevel(level),
      goal: formatLevel(options.goal),
      weeks: met,
      ask_stop: askStop,
    });
    if (!askStop) cardGiven = true;
  }
  return out;
}

// ---------- answering prompts and pending changes ----------

export type StepAnswer = 'yes' | 'not now' | 'at goal' | 'stop asking' | 'keep asking';

/**
 * Answer a step-up prompt. "yes" makes a pending level change (one step, `option` picks which when there are two);
 * the owner still has to accept it. Every answer is logged and moves the next prompt on by the habit's pace.
 */
export async function answerStepUp(ctx: Ctx, habitId: string, answer: StepAnswer, option?: 'sessions' | 'size') {
  await requireFeature(ctx, STEP_UP_FLAG);
  const h = await get(ctx, habitsEntity, habitId);
  if (h.status !== 'active') throw bad('Only an active habit has step-up prompts');
  const today = await ctx.today();
  const every = parseEvery(h.step_up_every as string | null) ?? 14;
  const next = `${addDays(today, every)}T00:00:00.000Z`;
  const patch: Record<string, unknown> = {};
  let pending: Pending | null = null;
  const current = levelFromRow(h); // the habit row always holds the level in force now
  switch (answer) {
    case 'yes': {
      const steps = stepOptions(h, current);
      if (!steps) throw bad('There is no step left towards the goal');
      const chosen = option ? steps.options.find((o) => o.kind === option) : steps.options[steps.suggested];
      if (!chosen) throw bad(`That step is not available. Options: ${steps.options.map((o) => o.kind).join(', ')}`);
      const day = dueDayFor(current.per, today);
      await removeWhere(ctx, habitLogEntity, { habit_id: habitId, kind: 'pending' });
      await create(ctx, habitLogEntity, { habit_id: habitId, day, kind: 'pending', count: chosen.level.sessions ?? 1, value: chosen.text });
      pending = { day, text: chosen.text, due: day <= today };
      patch.next_prompt = next;
      break;
    }
    case 'not now':
    case 'keep asking':
      patch.next_prompt = next;
      break;
    case 'at goal':
      patch.prompts = 'at goal';
      patch.goal = formatLevel(current);
      patch.next_prompt = null;
      break;
    case 'stop asking':
      patch.prompts = 'off';
      patch.next_prompt = null;
      break;
  }
  await upsertLog(ctx, habitId, today, 'answer', 1, answer);
  // The notification that asked the question is answered too.
  await ctx.db
    .prepare('UPDATE notifications SET dismissed_at = ? WHERE mode = ? AND dismissed_at IS NULL AND dedupe_key LIKE ?')
    .bind(ctx.now(), ctx.mode, `habit:${habitId}:%`)
    .run();
  const habit = await update(ctx, habitsEntity, habitId, patch);
  return { habit, pending };
}

/** Accept a waiting level change (it applies from this week's Monday for a weekly habit, today for a daily one) or put it off. */
export async function answerPending(ctx: Ctx, habitId: string, answer: 'accept' | 'not yet') {
  const h = await get(ctx, habitsEntity, habitId);
  const pend = (await list(ctx, habitLogEntity, { where: { habit_id: habitId, kind: 'pending' }, limit: 1 }))[0];
  if (!pend) throw bad('This habit has no level change waiting');
  const today = await ctx.today();
  const level = parseLevel(pend.value as string | null, h.per === 'week' ? 'week' : 'day');
  if (!level) throw bad('The waiting level change cannot be read');
  if (answer === 'not yet') {
    const day = dueDayFor(level.per, today);
    return { habit: h, pending: await update(ctx, habitLogEntity, pend.id, { day }) };
  }
  if (String(pend.day) > today) throw bad(`This change is not due until ${pend.day}`);
  // Editing the level writes the level row and drops the pending row (the habit's beforeUpdate hook).
  const habit = await update(ctx, habitsEntity, habitId, {
    sessions: level.sessions,
    per: level.per,
    size: level.size == null ? null : level.unit ? `${level.size} ${level.unit}` : String(level.size),
  });
  return { habit, pending: null };
}

// ---------- the module ----------

/** What Claude (and the step-up screens) need to judge every active habit with a goal, due or not. */
export async function stepUpReview(ctx: Ctx) {
  const today = await ctx.today();
  const [habits, meta, done, away] = await Promise.all([
    list(ctx, habitsEntity, { where: { status: 'active' } }),
    list(ctx, habitLogEntity, { sql: 'kind IN (?, ?, ?, ?)', params: ['level', 'pending', 'pause', 'resume'], order: 'day', limit: 2000 }),
    list(ctx, habitLogEntity, { where: { kind: 'done' }, sql: 'day >= ?', params: [addDays(mondayOf(today), -7 * MAX_WEEKS)], limit: 2000 }),
    awayForTargets(ctx),
  ]);
  return habits.map((h) => {
    const history = levelHistory(h, meta);
    const level = levelForDay(h, history, today);
    const opts = stepOptions(h, level);
    const since = history.length ? history[history.length - 1].day : String(h.started ?? h.created).slice(0, 10);
    const weeks = fullWeeks(since, today, pauseIntervals(meta.filter((m) => m.habit_id === h.id), today));
    const met = weeksMet(level, weeks, done.filter((d) => d.habit_id === h.id), away);
    const pend = meta.find((m) => m.habit_id === h.id && m.kind === 'pending');
    return {
      id: h.id,
      name: h.name,
      level: formatLevel(level),
      goal: h.goal ?? null,
      prompts: h.prompts ?? null,
      step_up_every: h.step_up_every ?? null,
      next_prompt: h.next_prompt ?? null,
      prompt_due: h.next_prompt != null && String(h.next_prompt).slice(0, 10) <= today,
      full_weeks_counted: met.weeks,
      sessions_done: met.done,
      sessions_target: met.target,
      level_met: isMet(met),
      options: opts ? opts.options.map(optionOf) : [],
      suggested: opts ? opts.suggested : null,
      pending: pend ? { due: pend.day, level: pend.value } : null,
    };
  });
}

export const habitsModule: Module = {
  id: 'habits',
  description: 'Habits, their daily log, level history and step-up prompts.',
  entities: [habitsEntity, habitLogEntity],
  features: [
    {
      id: HABITS_FLAG,
      label: 'Habits',
      description: 'The whole Habits feature: the Habits tab and panels, habits on the Today list, counts, menu bar, widgets and notifications, their parts of Insights and Plan my week, and Claude’s habit tools. Off: all of that is hidden and refused; your habits and their history stay and come back when it is on.',
      default: true,
    },
    {
      id: STEP_UP_FLAG,
      label: 'Habit step-up prompts',
      description: 'Ask "Want to go further?" when a habit’s level has been met, and let the owner accept a bigger level. Off: habits keep the level they have until edited.',
      default: true,
    },
    {
      id: AWAY_FLAG,
      label: 'Away days lower daily habit targets',
      description: 'A daily habit asks nothing on a day that is Away in the rotation: the day is left out of its weekly target (step-up prompts, Insights, Plan my week). Weekly habits keep their target.',
      default: true,
    },
  ],
  routes(api) {
    api.use('/habits/*', async (c, next) => {
      await requireFeature(c.get('ctx'), HABITS_FLAG);
      await next();
    });
    api.get('/habits/progress', async (c) => c.json(await habitProgress(c.get('ctx'), c.req.query('day'))));
    api.post('/habits/:id/check', async (c) => {
      const ctx = c.get('ctx');
      ctx.label = 'check habit';
      const b = await c.req.json<{ day?: string; add?: number; count?: number }>().catch(() => ({}) as Record<string, never>);
      const id = c.req.param('id');
      if (typeof b.count === 'number') return c.json(await setHabitCount(ctx, id, b.day ?? (await ctx.today()), b.count));
      return c.json(await checkHabit(ctx, id, b.day, b.add ?? 1));
    });
    api.post('/habits/:id/not-today', async (c) => {
      const ctx = c.get('ctx');
      const b = await c.req.json<{ on?: unknown; day?: string }>().catch(() => ({}) as { on?: unknown; day?: string });
      if (typeof b.on !== 'boolean') throw bad('Send {"on": true} (not today) or {"on": false} (back on today’s list)');
      ctx.label = b.on ? 'habit not today' : 'habit back on today';
      return c.json(await skipHabit(ctx, c.req.param('id'), b.on, b.day));
    });
    api.post('/habits/:id/step-up', async (c) => {
      const ctx = c.get('ctx');
      ctx.label = 'answer step-up';
      const b = await c.req.json<{ answer?: string; option?: string }>().catch(() => ({}) as Record<string, never>);
      const answers = ['yes', 'not now', 'at goal', 'stop asking', 'keep asking'];
      if (!answers.includes(String(b.answer))) throw bad(`answer must be one of: ${answers.join(', ')}`);
      if (b.option != null && b.option !== 'sessions' && b.option !== 'size') throw bad('option must be sessions or size');
      return c.json(await answerStepUp(ctx, c.req.param('id'), b.answer as StepAnswer, b.option as 'sessions' | 'size' | undefined));
    });
    api.post('/habits/:id/pending', async (c) => {
      const ctx = c.get('ctx');
      const b = await c.req.json<{ answer?: string }>().catch(() => ({}) as Record<string, never>);
      if (b.answer !== 'accept' && b.answer !== 'not yet') throw bad('answer must be accept or not yet');
      ctx.label = b.answer === 'accept' ? 'accept new level' : 'put off new level';
      return c.json(await answerPending(ctx, c.req.param('id'), b.answer));
    });
    api.get('/habits/step-ups', async (c) => c.json(await stepUpReview(c.get('ctx'))));
  },
  tools: [
    {
      name: 'habit_progress',
      description:
        'Active habits with sessions done today / this week, how many are left, the level that applies now, the last 7 days (or the week), ' +
        'a waiting level change (pending), a step-up prompt that is due (step_up, with options) and the habit’s notes (Markdown; change them with update_item, field notes).',
      readOnly: true,
      feature: HABITS_FLAG,
      input: z.object({ day: z.string().optional() }),
      run: (ctx, a) => habitProgress(ctx, a.day),
    },
    {
      name: 'check_habit',
      description: 'Record sessions of a habit as done (add 1 by default; a negative add removes). day defaults to today; it can be up to 7 days back.',
      feature: HABITS_FLAG,
      input: z.object({ id: z.string(), day: z.string().optional(), add: z.number().int().default(1) }),
      run: (ctx, a) => checkHabit(ctx, a.id, a.day, a.add),
    },
    {
      name: 'habit_step_ups',
      description:
        'For every active habit: its level, goal, how much of the target was done in the full weeks since the level last changed (paused weeks left out), ' +
        'whether that counts as met (80 %), whether the prompt is due, the next step(s) towards the goal and any waiting change. Use it to suggest a step-up.',
      readOnly: true,
      feature: [HABITS_FLAG, STEP_UP_FLAG],
      input: z.object({}),
      run: (ctx) => stepUpReview(ctx),
    },
    {
      name: 'answer_step_up',
      description:
        'Answer a habit’s step-up prompt for the owner: "yes" makes a pending level change (one step; option "sessions" or "size" when both are possible) that the owner still has to accept on Today; ' +
        '"not now" asks again after the habit’s pace; "at goal" stops prompts and sets the goal to the current level; "stop asking" / "keep asking" answer "Stop asking about this habit?". Only when the owner has said which.',
      feature: [HABITS_FLAG, STEP_UP_FLAG],
      input: z.object({
        id: z.string(),
        answer: z.enum(['yes', 'not now', 'at goal', 'stop asking', 'keep asking']),
        option: z.enum(['sessions', 'size']).optional(),
      }),
      run: (ctx, a) => answerStepUp(ctx, a.id, a.answer, a.option),
    },
    {
      name: 'answer_pending_level',
      description:
        'Accept a habit’s waiting level change (it applies from this week for a weekly habit, from today for a daily one) or put it off to next Monday / tomorrow ("not yet"). Only when the owner says so.',
      feature: HABITS_FLAG,
      input: z.object({ id: z.string(), answer: z.enum(['accept', 'not yet']) }),
      run: (ctx, a) => answerPending(ctx, a.id, a.answer),
    },
    {
      name: 'add_aspiring_habit',
      description:
        'Note an idea for a habit the owner is not starting yet (name, optional why). It is shown in its own group on the Habits tab and never on Today. ' +
        'To start it later, update_item the habit with status "active" and its sessions, per, size, goal.',
      feature: HABITS_FLAG,
      input: z.object({ name: z.string().min(1), description: z.string().optional(), notes: z.string().optional().describe('Notes and useful information (Markdown)') }),
      run: (ctx, a) => create(ctx, habitsEntity, { name: a.name, description: a.description, notes: a.notes, status: 'aspiring' }),
    },
  ],
};

/** Habits for the Today list, counts, menu bar, widgets and notifications: none while the Habits feature is off. */
export async function habitProgressIfOn(ctx: Ctx, day?: string): ReturnType<typeof habitProgress> {
  return (await ctx.feature(HABITS_FLAG)) ? habitProgress(ctx, day) : [];
}
