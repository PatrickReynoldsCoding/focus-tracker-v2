// A habit's weekdays (D68, habits.days): validation, Today and everything built from it (the Today
// list, status for the widgets and the menu bar, notifications) leave the habit out on other days,
// a weekly habit keeps its target, a daily one only asks on its days (progress, step-up maths,
// Insights), Plan my week only plans it on its days, Not today and undo still work.
import { env } from 'cloudflare:test';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Ctx } from '../src/core/ctx';
import { dayKeyOf, formatDays, normaliseDays, showsOn } from '../src/core/habit-days';
import { buildTodayList, habitItem } from '../src/core/today-list';
import { register } from '../src/core/registry';
import { create } from '../src/core/store';
import { habitProgress, habitsEntity, restDays, skipHabit, weeksMet } from '../src/modules/habits';
import { MODULES } from '../src/modules/index';
import { habitsHistory, habitWeek } from '../src/modules/insights';
import { pendingNotifications } from '../src/modules/notifications';
import { planSession, weekPlan } from '../src/modules/plan';
import { swiftbarText } from '../src/modules/swiftbar';
import { status, today } from '../src/modules/today';
import { todayList } from '../src/modules/today-list';
import { parseLevel } from '../src/core/habit-levels';
import { call, tool, toolError } from './helpers';

register(MODULES);

const T = '2026-11-01T00:00:00.000Z';
// Noon in London (UTC in November): Monday 23, Tuesday 24, Wednesday 25, Thursday 26 November 2026.
const MON = '2026-11-23T12:00:00.000Z';
const TUE = '2026-11-24T12:00:00.000Z';
const WED = '2026-11-25T12:00:00.000Z';
const at = (iso: string, mode: string) => new Ctx(env as any, mode, new Date(iso));

let n = 0;
async function freshMode() {
  const id = `days${++n}${Math.random().toString(36).slice(2, 6)}`;
  const m = await call('POST', '/modes', { label: `Habit days ${id}`, id });
  return m.id as string;
}
async function tz(zone: string) {
  await env.DB.prepare("INSERT OR REPLACE INTO settings (mode, key, value, updated_at) VALUES ('', 'timezone', ?, ?)").bind(zone, T).run();
}
async function hlog(mode: string, habit_id: string, day: string, kind: string, count = 1) {
  await env.DB.prepare('INSERT INTO habit_log (id, mode, habit_id, day, kind, count, created, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(`l${++n}${Math.random().toString(36).slice(2, 6)}`, mode, habit_id, day, kind, count, T, T)
    .run();
}
/** A habit made through the store (so days are checked) as on `iso`, started well before. */
async function habit(mode: string, fields: Record<string, unknown>, iso = MON) {
  return create(at(iso, mode), habitsEntity, { status: 'active', started: '2026-10-01', ...fields });
}

beforeEach(async () => {
  await tz('Europe/London');
});
afterAll(async () => {
  await tz('Europe/London');
});

describe('the days field', () => {
  it('reads weekdays into Monday-first text; none or all seven is every day', () => {
    expect(normaliseDays('Thu, tue')).toBe('tue,thu');
    expect(normaliseDays('tuesday thursday tues')).toBe('tue,thu');
    expect(normaliseDays(['sun', 'mon'])).toBe('mon,sun');
    expect(normaliseDays('')).toBeNull();
    expect(normaliseDays(null)).toBeNull();
    expect(normaliseDays('mon,tue,wed,thu,fri,sat,sun')).toBeNull();
    expect(() => normaliseDays('tue,funday')).toThrow(/"funday" is not a weekday/);
    expect(() => normaliseDays('t')).toThrow(/not a weekday/);
    expect(dayKeyOf('2026-11-24')).toBe('tue');
    expect(dayKeyOf('2026-11-29')).toBe('sun');
    expect(showsOn('tue,thu', '2026-11-24')).toBe(true);
    expect(showsOn('tue,thu', '2026-11-25')).toBe(false);
    expect(showsOn(null, '2026-11-25')).toBe(true);
    expect(formatDays('tue,thu')).toBe('Tue, Thu');
    expect(formatDays(null)).toBeNull();
  });

  it('is checked and stored the same way by REST and Claude’s tools, and undone', async () => {
    const m = { mode: await freshMode() };
    const h = await call('POST', '/habits', { name: 'Exercise', sessions: 2, per: 'week', days: 'Tue, Thursday' }, m);
    expect(h.days).toBe('tue,thu');
    await call('POST', '/habits', { name: 'Bad', sessions: 1, per: 'week', days: 'someday' }, { ...m, expect: 400 });
    await call('PATCH', `/habits/${h.id}`, { days: 'mon,wed' }, m);
    expect((await call('GET', `/habits/${h.id}`, undefined, m)).days).toBe('mon,wed');
    await call('POST', '/undo', {}, m);
    expect((await call('GET', `/habits/${h.id}`, undefined, m)).days).toBe('tue,thu');
    await call('PATCH', `/habits/${h.id}`, { days: '' }, m);
    expect((await call('GET', `/habits/${h.id}`, undefined, m)).days).toBeNull();

    const made = await tool<any>('create_item', { kind: 'habits', mode: m.mode, fields: { name: 'Swim', sessions: 1, per: 'week', days: 'sat' } });
    expect(made.days).toBe('sat');
    await tool('update_item', { kind: 'habits', mode: m.mode, id: made.id, fields: { days: 'fri,sat' } });
    expect((await tool<any>('get_item', { kind: 'habits', mode: m.mode, id: made.id })).days).toBe('fri,sat');
    expect(await toolError('update_item', { kind: 'habits', mode: m.mode, id: made.id, fields: { days: 'noday' } })).toMatch(/not a weekday/);
    const kinds = JSON.stringify(await tool<any>('describe_kinds', { mode: m.mode }));
    expect(kinds).toMatch(/weekdays the habit shows on Today/);
  });
});

describe('Today on chosen days only', () => {
  it('leaves a days-limited habit out of Today, the Today list, status and the menu bar on other days', async () => {
    const mode = await freshMode();
    const weekly = await habit(mode, { name: 'Exercise', sessions: 2, per: 'week', days: 'tue,thu' });
    const daily = await habit(mode, { name: 'Stretch', sessions: 1, per: 'day', days: 'tue,thu' });
    await habit(mode, { name: 'Read', sessions: 1, per: 'day' });

    const names = (xs: { name?: string; title?: string }[]) => xs.map((x) => x.name ?? x.title).sort();
    // Wednesday: only the every-day habit.
    const wed = at(WED, mode);
    expect(names((await today(wed)).habits)).toEqual(['Read']);
    expect(names((await todayList(wed)).items.filter((x) => x.kind === 'habit'))).toEqual(['Read']);
    const sWed = await status(wed);
    expect(names(sWed.habits_left)).toEqual(['Read']);
    expect(names(sWed.today_list!.items.filter((x) => x.kind === 'habit'))).toEqual(['Read']);
    const barWed = await swiftbarText(wed, 'https://ft.example.com');
    expect(barWed).toContain('Read');
    expect(barWed).not.toContain('Exercise');
    expect(barWed).not.toContain('Stretch');

    // Tuesday: all three, and both count in the badge's list.
    const tue = at(TUE, mode);
    expect(names((await today(tue)).habits)).toEqual(['Exercise', 'Read', 'Stretch']);
    const listTue = await todayList(tue);
    expect(names(listTue.items.filter((x) => x.kind === 'habit'))).toEqual(['Exercise', 'Read', 'Stretch']);
    expect(listTue.left).toBe(3);
    expect(names((await status(tue)).habits_left)).toEqual(['Exercise', 'Read', 'Stretch']);
    expect(await swiftbarText(tue, 'https://ft.example.com')).toContain('Exercise');

    // The Habits tab still sees every habit, marked off on Wednesday.
    const all = await habitProgress(wed);
    expect(all.find((h) => h.id === weekly.id)).toMatchObject({ on_days: 'tue,thu', off_day: true });
    expect(all.find((h) => h.id === daily.id)).toMatchObject({ off_day: true, left: 0 });
    expect(all.find((h) => h.name === 'Read')).toMatchObject({ on_days: null, off_day: false, left: 1 });
    const strip = all.find((h) => h.id === weekly.id)!.days;
    expect(strip.filter((d) => !d.off).map((d) => d.day)).toEqual(['2026-11-24', '2026-11-26']);
  });

  it('keeps Not today working on a chosen day', async () => {
    const mode = await freshMode();
    const h = await habit(mode, { name: 'Exercise', sessions: 2, per: 'week', days: 'tue,thu' });
    const tue = at(TUE, mode);
    await skipHabit(tue, h.id, true);
    const item = (await todayList(tue)).items.find((x) => x.id === h.id);
    expect(item).toMatchObject({ state: 'skipped' });
    expect((await status(tue)).habits_left.map((x) => x.id)).not.toContain(h.id);
    // Thursday it is open again.
    expect((await todayList(at('2026-11-26T12:00:00.000Z', mode))).items.find((x) => x.id === h.id)).toMatchObject({ state: 'open' });
  });

  it('the shared builder leaves out a habit whose day it is not', () => {
    const h = { id: 'h', name: 'Run', per: 'week', target: 2, done_today: 0, done_this_period: 0, skipped_today: false };
    expect(habitItem({ ...h, off_day: true })).toBeNull();
    expect(buildTodayList('2026-11-25', { habits: [{ ...h, off_day: true }, { ...h, id: 'r', name: 'Read' }] }).items.map((x) => x.title)).toEqual(['Read']);
  });

  it('does not prompt on a day the habit is not on', async () => {
    const mode = await freshMode();
    const h = await habit(mode, { name: 'Exercise', sessions: 2, per: 'week', days: 'tue,thu' });
    await env.DB.prepare('UPDATE habits SET next_prompt = ? WHERE id = ?').bind('2026-11-20T00:00:00.000Z', h.id).run();
    const kinds = async (iso: string) => (await pendingNotifications(at(iso, mode))).filter((x: any) => x.kind === 'habit').map((x: any) => x.title);
    expect(await kinds(WED)).toEqual([]);
    expect(await kinds('2026-11-26T12:00:00.000Z')).toEqual(['Exercise']);
  });
});

describe('targets, streaks and Insights', () => {
  it('keeps a weekly habit’s target: days not chosen are never missed', async () => {
    const mode = await freshMode();
    const h = await habit(mode, { name: 'Exercise', sessions: 2, per: 'week', days: 'tue,thu' });
    await hlog(mode, h.id, '2026-11-24', 'done');
    const p = (await habitProgress(at(WED, mode))).find((x) => x.id === h.id)!;
    expect(p).toMatchObject({ target: 2, done_this_period: 1, left: 1, off_day: true });
    // A session on an unchosen day still counts towards the week.
    await hlog(mode, h.id, '2026-11-25', 'done');
    expect((await habitProgress(at(WED, mode))).find((x) => x.id === h.id)).toMatchObject({ done_this_period: 2, left: 0 });
    // Insights: last week (16–22 Nov) with two sessions on Tue and Thu is met, target 2.
    await hlog(mode, h.id, '2026-11-17', 'done');
    await hlog(mode, h.id, '2026-11-19', 'done');
    const hist = await habitsHistory(at(WED, mode), 2);
    const week = hist.habits.find((x) => x.id === h.id)!.weeks.find((w) => w.week === '2026-11-16')!;
    expect(week).toMatchObject({ target: 2, counted: 2, status: 'met' });
  });

  it('asks a daily habit for sessions only on its days (progress, step-up maths, Insights)', async () => {
    const mode = await freshMode();
    const h = await habit(mode, { name: 'Stretch', sessions: 1, per: 'day', days: 'tue,thu' });
    // Tuesday: one asked; Wednesday: nothing asked.
    expect((await habitProgress(at(TUE, mode))).find((x) => x.id === h.id)).toMatchObject({ off_day: false, left: 1 });
    expect((await habitProgress(at(WED, mode))).find((x) => x.id === h.id)).toMatchObject({ off_day: true, left: 0 });
    // A full week with Tue and Thu done is all of the target.
    const done = [
      { kind: 'done', day: '2026-11-17', count: 1 },
      { kind: 'done', day: '2026-11-19', count: 1 },
      { kind: 'done', day: '2026-11-20', count: 1 }, // a Friday: extra, not counted
    ];
    const level = parseLevel('1 a day', 'day')!;
    expect(weeksMet(level, ['2026-11-16'], done as any, restDays(h))).toEqual({ weeks: 1, done: 2, target: 2 });
    expect(weeksMet(level, ['2026-11-16'], done as any)).toEqual({ weeks: 1, done: 3, target: 7 }); // without days: every day
    // Insights' week: the same target of 2, met.
    const w = habitWeek({ habit: h, history: [], pauses: [], rows: done as any, start: '2026-10-01', away: restDays(h) }, '2026-11-16', '2026-11-25');
    expect(w).toMatchObject({ target: 2, counted: 2, over: 1, status: 'met' });
    // Through habitsHistory too.
    for (const d of done) await hlog(mode, h.id, d.day, 'done');
    const hist = await habitsHistory(at(WED, mode), 2);
    expect(hist.habits.find((x) => x.id === h.id)!.weeks.find((x) => x.week === '2026-11-16')).toMatchObject({ target: 2, counted: 2, status: 'met' });
  });
});

describe('Plan my week', () => {
  it('plans a days-limited habit only on its days, and a daily one asks for those days only', async () => {
    const mode = await freshMode();
    const weekly = await habit(mode, { name: 'Exercise', sessions: 2, per: 'week', days: 'tue,thu' });
    const daily = await habit(mode, { name: 'Stretch', sessions: 1, per: 'day', days: 'tue,thu' });
    const mon = at(MON, mode);
    const plan = await weekPlan(mon, 'this');
    expect(plan.habits.find((x) => x.id === weekly.id)).toMatchObject({ days: 'tue,thu', target: 2 });
    expect(plan.habits.find((x) => x.id === daily.id)).toMatchObject({ days: 'tue,thu', target: 2 });
    await expect(planSession(mon, weekly.id, '2026-11-25', { add: 1 })).rejects.toThrow(/only on Tue, Thu/);
    expect((await planSession(mon, weekly.id, '2026-11-24', { add: 1 })).planned).toBe(1);
    // A plan left on another day (made before the days were chosen) can still be taken off.
    await hlog(mode, weekly.id, '2026-11-27', 'plan', 2);
    expect((await planSession(mon, weekly.id, '2026-11-27', { add: -1 })).planned).toBe(1);
    expect((await planSession(mon, weekly.id, '2026-11-27', { count: 0 })).planned).toBe(0);
  });

  it('an undone plan comes off the day (planning goes through the store)', async () => {
    const mode = await freshMode();
    const h = await call('POST', '/habits', { name: 'Exercise', sessions: 2, per: 'week' }, { mode });
    const todayIso = (await call<{ day: string }>('GET', '/today', undefined, { mode })).day;
    await call('PATCH', `/habits/${h.id}`, { days: dayKeyOf(todayIso) }, { mode });
    expect((await call<any>('GET', '/today', undefined, { mode })).habits.map((x: any) => x.id)).toContain(h.id);
    // Days that leave today out take it off Today (and its count); undo brings it back.
    const other = dayKeyOf(new Date(Date.parse(`${todayIso}T12:00:00Z`) + 864e5).toISOString().slice(0, 10));
    await call('PATCH', `/habits/${h.id}`, { days: other }, { mode });
    expect((await call<any>('GET', '/today', undefined, { mode })).habits.map((x: any) => x.id)).not.toContain(h.id);
    expect((await call<any>('GET', '/today/list', undefined, { mode })).items.map((x: any) => x.id)).not.toContain(h.id);
    await call('POST', '/undo', {}, { mode });
    expect((await call<any>('GET', '/today', undefined, { mode })).habits.map((x: any) => x.id)).toContain(h.id);
    await call('POST', '/plan/sessions', { habit_id: h.id, day: todayIso, add: 1 }, { mode });
    const planned = async () => (await call<any>('GET', '/plan?week=this', undefined, { mode })).habits.find((x: any) => x.id === h.id).planned;
    expect(await planned()).toBe(1);
    await call('POST', '/undo', {}, { mode });
    expect(await planned()).toBe(0);
  });
});
