// The weekly rotation: which kind of project each weekday is for (a category id, "any" or "away").
// Stored per mode in settings:
//   rotation.<weekday>          the usual week
//   week.of, week.<weekday>     changes for the week that starts on Monday `week.of` (this week)
//   next.of, next.<weekday>     changes for next week, made in Plan my week
// When next week starts, its changes become this week's (`week.*`): that roll-over happens on the
// first read of the rotation in that week, so no scheduled job is needed. Changes for a week that has
// gone are never used for this week; the last week's stay readable so Insights can leave out its away days.
// Used by Today (src/modules/today.ts), habits and Insights (away days) and Plan my week (src/modules/plan.ts).

import { addDays, type Ctx } from './ctx';
import { bad } from './errors';

export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Monday of the week that holds `day`. */
export function mondayOf(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return addDays(day, -((d.getUTCDay() + 6) % 7));
}

export const weekdayOf = (day: string): Weekday => WEEKDAYS[(new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7];

export interface WeekChanges {
  /** The Monday the changes are for (null: none stored). */
  of: string | null;
  days: Partial<Record<Weekday, string>>;
}

export interface Rotation {
  today: string;
  this_monday: string;
  next_monday: string;
  usual: Record<Weekday, string>;
  week: WeekChanges;
  next: WeekChanges;
}

async function readAll(ctx: Ctx): Promise<Map<string, string>> {
  const rows = await ctx.db
    .prepare("SELECT key, value FROM settings WHERE mode = ? AND (key LIKE 'rotation.%' OR key LIKE 'week.%' OR key LIKE 'next.%')")
    .bind(ctx.mode)
    .all<{ key: string; value: string | null }>();
  const out = new Map<string, string>();
  for (const r of rows.results) if (r.value != null && r.value !== '') out.set(r.key, r.value);
  return out;
}

function changesOf(all: Map<string, string>, prefix: 'week' | 'next'): WeekChanges {
  const days: WeekChanges['days'] = {};
  for (const w of WEEKDAYS) {
    const v = all.get(`${prefix}.${w}`);
    if (v) days[w] = v;
  }
  return { of: all.get(`${prefix}.of`) ?? null, days };
}

async function clear(ctx: Ctx, prefix: 'week' | 'next') {
  for (const w of WEEKDAYS) await ctx.setSetting(`${prefix}.${w}`, null);
  await ctx.setSetting(`${prefix}.of`, null);
}

/**
 * The rotation as stored, after the roll-over: next week's changes become this week's once that week
 * has started, and changes for a next week that has already gone are dropped.
 */
export async function loadRotation(ctx: Ctx): Promise<Rotation> {
  const today = await ctx.today();
  const thisMonday = mondayOf(today);
  let all = await readAll(ctx);
  const nextOf = all.get('next.of');
  if (nextOf && nextOf <= thisMonday) {
    if (nextOf === thisMonday && all.get('week.of') !== thisMonday) {
      const next = changesOf(all, 'next');
      for (const w of WEEKDAYS) await ctx.setSetting(`week.${w}`, next.days[w] ?? null);
      await ctx.setSetting('week.of', thisMonday);
    }
    await clear(ctx, 'next');
    all = await readAll(ctx);
  }
  const usual = Object.fromEntries(WEEKDAYS.map((w) => [w, all.get(`rotation.${w}`) ?? 'any'])) as Record<Weekday, string>;
  return { today, this_monday: thisMonday, next_monday: addDays(thisMonday, 7), usual, week: changesOf(all, 'week'), next: changesOf(all, 'next') };
}

/** The changes that apply to the week holding `day` (empty when that week has none). */
export function changesFor(r: Rotation, day: string): WeekChanges['days'] {
  const monday = mondayOf(day);
  if (r.week.of === monday) return r.week.days;
  if (r.next.of === monday) return r.next.days;
  return {};
}

/** What a day is for: its value, the usual one and whether this week (or next) changed it. */
export function leadOn(r: Rotation, day: string): { value: string; usual: string; changed: boolean } {
  const w = weekdayOf(day);
  const changed = changesFor(r, day)[w];
  return { value: changed ?? r.usual[w], usual: r.usual[w], changed: changed != null && changed !== r.usual[w] };
}

/** A quick "is this day away?" for habit targets. */
export async function awayLookup(ctx: Ctx): Promise<(day: string) => boolean> {
  const r = await loadRotation(ctx);
  return (day: string) => leadOn(r, day).value === 'away';
}

/**
 * Change this week's or next week's rotation (value null = back to the usual). Changes left over from an
 * older week are cleared first, so a day changed weeks ago never comes back.
 */
export async function setWeekChanges(ctx: Ctx, which: 'week' | 'next', values: Record<string, string | null | undefined>): Promise<Rotation> {
  for (const w of Object.keys(values)) if (!WEEKDAYS.includes(w as Weekday)) throw bad(`Unknown weekday ${w}`);
  const r = await loadRotation(ctx);
  const monday = which === 'week' ? r.this_monday : r.next_monday;
  if (r[which].of !== monday) await clear(ctx, which);
  for (const [w, v] of Object.entries(values)) await ctx.setSetting(`${which}.${w}`, v || null);
  await ctx.setSetting(`${which}.of`, monday);
  return loadRotation(ctx);
}
