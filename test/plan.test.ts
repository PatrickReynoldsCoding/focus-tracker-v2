// Plan my week: week boundaries in the owner's time zone, next week's rotation rolling over into this
// week, planned sessions (habit_log kind 'plan'), to-dos on days, away days lowering daily targets,
// the Claude tools and the flags.
import { env } from 'cloudflare:test';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays, Ctx } from '../src/core/ctx';
import { setFeature } from '../src/core/features';
import { register } from '../src/core/registry';
import { loadRotation } from '../src/core/rotation';
import { habitProgress, weeksMet } from '../src/modules/habits';
import { MODULES } from '../src/modules/index';
import { habitWeek } from '../src/modules/insights';
import { planSession, scheduleTodo, setLead, weekPlan } from '../src/modules/plan';
import { rotation } from '../src/modules/today';
import { parseLevel } from '../src/core/habit-levels';
import { call, mcp, tool, toolError, flagEverywhere } from './helpers';

register(MODULES);

const T = '2026-11-01T00:00:00.000Z';
let n = 0;
const id = () => `p${++n}`;

async function tz(zone: string) {
  await env.DB.prepare("INSERT OR REPLACE INTO settings (mode, key, value, updated_at) VALUES ('', 'timezone', ?, ?)").bind(zone, T).run();
}
async function habit(mode: string, h: { name: string; sessions: number; per: 'day' | 'week'; started?: string; status?: string }) {
  const hid = id();
  await env.DB.prepare('INSERT INTO habits (id, mode, name, sessions, per, status, started, ord, created, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)')
    .bind(hid, mode, h.name, h.sessions, h.per, h.status ?? 'active', h.started ?? '2026-10-01', T, T)
    .run();
  return hid;
}
async function hlog(mode: string, habit_id: string, day: string, kind: string, count = 1) {
  await env.DB.prepare('INSERT INTO habit_log (id, mode, habit_id, day, kind, count, created, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id(), mode, habit_id, day, kind, count, T, T).run();
}
async function setting(mode: string, key: string, value: string | null) {
  if (value == null) await env.DB.prepare('DELETE FROM settings WHERE mode = ? AND key = ?').bind(mode, key).run();
  else await env.DB.prepare('INSERT OR REPLACE INTO settings (mode, key, value, updated_at) VALUES (?, ?, ?, ?)').bind(mode, key, value, T).run();
}
async function settings(mode: string, prefix: string) {
  const r = await env.DB.prepare('SELECT key, value FROM settings WHERE mode = ? AND key LIKE ? ORDER BY key').bind(mode, `${prefix}%`).all<{ key: string; value: string }>();
  return Object.fromEntries(r.results.map((x) => [x.key, x.value]));
}

const at = (iso: string, mode: string) => new Ctx(env as any, mode, new Date(iso));
// Wednesday 18 Nov 2026, noon in London.
const WED = '2026-11-18T12:00:00.000Z';

beforeEach(async () => {
  await tz('Europe/London');
});
afterAll(async () => {
  await tz('Europe/London');
});

describe('weeks in the owner’s time zone', () => {
  it('starts the week on the owner’s Monday, not UTC’s', async () => {
    // Sunday 22 Nov 23:30 UTC: still Sunday in London, already Monday 23 Nov in Auckland.
    const now = '2026-11-22T23:30:00.000Z';
    expect((await weekPlan(at(now, 'tz1'), 'this')).week_of).toBe('2026-11-16');
    expect((await weekPlan(at(now, 'tz1'), 'next')).week_of).toBe('2026-11-23');
    await tz('Pacific/Auckland');
    const p = await weekPlan(at(now, 'tz1'), 'this');
    expect(p.week_of).toBe('2026-11-23');
    expect(p.today).toBe('2026-11-23');
    expect(p.days[0]).toMatchObject({ day: '2026-11-23', weekday: 'monday', today: true, past: false });
    expect(p.days.map((d) => d.day).at(-1)).toBe('2026-11-29');
    const next = await weekPlan(at(now, 'tz1'), 'next');
    expect([next.week_of, next.end, next.plan_to]).toEqual(['2026-11-30', '2026-12-06', '2026-12-06']);
  });

  it('plans from today to next Sunday only, in the owner’s time zone', async () => {
    await tz('Pacific/Auckland');
    const ctx = at('2026-11-22T23:30:00.000Z', 'tz2'); // Monday 23 Nov in Auckland
    const h = await habit('tz2', { name: 'Walk', sessions: 3, per: 'week' });
    await expect(planSession(ctx, h, '2026-11-22', { add: 1 })).rejects.toThrow(/today and later/);
    await expect(planSession(ctx, h, '2026-12-07', { add: 1 })).rejects.toThrow(/next Sunday \(2026-12-06\)/);
    expect((await planSession(ctx, h, '2026-11-23', { add: 1 })).planned).toBe(1);
    expect((await planSession(ctx, h, '2026-12-06', { add: 1 })).planned).toBe(1);
  });
});

describe('next week’s rotation', () => {
  it('keeps next week’s changes apart, then makes them this week’s when that week starts', async () => {
    const M = 'roll1';
    const ctx = at(WED, M);
    await setting(M, 'rotation.friday', 'cat-writing');
    await setting(M, 'rotation.monday', 'cat-house');
    // This week: Thursday is away. Next week: Friday away, Monday any.
    await setLead(ctx, '2026-11-19', 'away');
    await setLead(ctx, '2026-11-27', 'away');
    await setLead(at(WED, M), '2026-11-23', 'any');
    expect(await settings(M, 'next.')).toEqual({ 'next.friday': 'away', 'next.monday': 'any', 'next.of': '2026-11-23' });
    const rot = await rotation(at(WED, M));
    expect(rot.this_week).toEqual({ thursday: 'away' });
    expect(rot.next_week).toEqual({ friday: 'away', monday: 'any' });
    expect(rot.today.category).toBe('any'); // Wednesday, usual

    const next = await weekPlan(at(WED, M), 'next');
    expect(next.days[4].lead).toEqual({ value: 'away', usual: 'cat-writing', changed: true });
    expect(next.days[0].lead).toEqual({ value: 'any', usual: 'cat-house', changed: true });
    expect(next.days[3].lead).toEqual({ value: 'any', usual: 'any', changed: false }); // next Thursday is not away
    const thisWeek = await weekPlan(at(WED, M), 'this');
    expect(thisWeek.days[3].away).toBe(true);
    expect(thisWeek.days[4].away).toBe(false);

    // Monday 23 Nov: the first read rolls next week over into this week.
    const mon = at('2026-11-23T07:00:00.000Z', M);
    const after = await rotation(mon);
    expect(after.today.category).toBe('any');
    expect(after.this_week).toEqual({ friday: 'away', monday: 'any' });
    expect(after.next_week).toEqual({});
    expect(await settings(M, 'next.')).toEqual({});
    expect(await settings(M, 'week.')).toEqual({ 'week.friday': 'away', 'week.monday': 'any', 'week.of': '2026-11-23' });
    expect((await rotation(at('2026-11-27T09:00:00.000Z', M))).today.category).toBe('away');
    // The week after, the usual rotation is back.
    expect((await rotation(at('2026-12-04T09:00:00.000Z', M))).today.category).toBe('cat-writing');
  });

  it('drops next-week changes for a week that has already gone, and never reuses an old week’s changes', async () => {
    const M = 'roll2';
    await setting(M, 'next.of', '2026-11-09');
    await setting(M, 'next.tuesday', 'away');
    await setting(M, 'week.of', '2026-11-02');
    await setting(M, 'week.wednesday', 'away');
    const r = await rotation(at(WED, M));
    expect(r.this_week).toEqual({});
    expect(r.today.category).toBe('any');
    expect(await settings(M, 'next.')).toEqual({});
    // Changing this week clears the old week's leftovers first.
    await setLead(at(WED, M), '2026-11-20', 'away');
    expect(await settings(M, 'week.')).toEqual({ 'week.friday': 'away', 'week.of': '2026-11-16' });
  });

  it('a lead set back to the usual value is no change; unknown categories and past days are refused', async () => {
    const M = 'roll3';
    await setting(M, 'rotation.saturday', 'away');
    const ctx = at(WED, M);
    expect(await setLead(ctx, '2026-11-21', 'any')).toMatchObject({ value: 'any', changed: true });
    expect(await setLead(at(WED, M), '2026-11-21', 'away')).toMatchObject({ value: 'away', changed: false });
    expect(await settings(M, 'week.saturday')).toEqual({});
    await expect(setLead(at(WED, M), '2026-11-21', 'nope')).rejects.toThrow(/not found|No category/i);
    await expect(setLead(at(WED, M), '2026-11-17', 'away')).rejects.toThrow(/today and later/);
  });

  it('set_rotation takes next_week too', async () => {
    const r = await tool('set_rotation', { next_week: { sunday: 'away' } });
    expect(r.next_week).toEqual({ sunday: 'away' });
    const back = await tool('set_rotation', { next_week: { sunday: null } });
    expect(back.next_week).toEqual({});
  });
});

describe('planned sessions', () => {
  it('adds, removes and caps plan rows; only active habits; done is kept apart', async () => {
    const M = 'rows1';
    const ctx = at(WED, M);
    const h = await habit(M, { name: 'Run', sessions: 3, per: 'week' });
    const paused = await habit(M, { name: 'Read', sessions: 2, per: 'week', status: 'paused' });
    await hlog(M, h, '2026-11-17', 'done', 1);
    expect((await planSession(ctx, h, '2026-11-19', { add: 1 })).planned).toBe(1);
    expect((await planSession(at(WED, M), h, '2026-11-19', { add: 1 })).planned).toBe(2);
    expect((await planSession(at(WED, M), h, '2026-11-21', { add: 1 })).planned).toBe(1);
    expect((await planSession(at(WED, M), h, '2026-11-24', { add: 1 })).planned).toBe(1); // next week
    expect((await planSession(at(WED, M), h, '2026-11-19', { add: -1 })).planned).toBe(1);
    expect((await planSession(at(WED, M), h, '2026-11-20', { add: -1 })).planned).toBe(0);
    expect((await planSession(at(WED, M), h, '2026-11-22', { count: 99 })).planned).toBe(20);
    expect((await planSession(at(WED, M), h, '2026-11-22', { count: 0 })).planned).toBe(0);
    await expect(planSession(at(WED, M), paused, '2026-11-19', { add: 1 })).rejects.toThrow(/not active/);
    const rows = await env.DB.prepare("SELECT day, count FROM habit_log WHERE mode = ? AND kind = 'plan' ORDER BY day").bind(M).all();
    expect(rows.results).toEqual([
      { day: '2026-11-19', count: 1 },
      { day: '2026-11-21', count: 1 },
      { day: '2026-11-24', count: 1 },
    ]);

    const p = await weekPlan(at(WED, M), 'this');
    expect(p.habits).toEqual([expect.objectContaining({ id: h, name: 'Run', per: 'week', target: 3, planned: 2, done: 1 })]);
    expect(p.days[1].habits).toEqual([{ habit_id: h, planned: 0, done: 1, skipped: false }]);
    expect(p.days[3].habits).toEqual([{ habit_id: h, planned: 1, done: 0, skipped: false }]);
    expect((await weekPlan(at(WED, M), 'next')).habits[0]).toMatchObject({ planned: 1, done: 0 });

    // Today and Insights see the plan.
    const prog = (await habitProgress(at(WED, M))).find((x) => x.id === h)!;
    expect(prog.planned_today).toBe(0);
    expect(prog.planned_later).toBe(2);
    expect(prog.days.find((d) => d.day === '2026-11-19')).toMatchObject({ planned: 1, future: true });
    const prog19 = (await habitProgress(at('2026-11-19T12:00:00.000Z', M))).find((x) => x.id === h)!;
    expect([prog19.planned_today, prog19.planned_later]).toEqual([1, 1]);
  });

  it('puts to-dos on days, takes them off, and lists the unscheduled and earlier ones', async () => {
    const M = 'todo1';
    const ctx = at(WED, M);
    await env.DB.prepare("INSERT INTO lists (id, mode, name, kind, ord, created, updated_at) VALUES ('tl1', ?, 'To-dos', 'todo', 0, ?, ?)").bind(M, T, T).run();
    await env.DB.prepare("INSERT INTO columns (id, mode, list_id, name, ord, created, updated_at) VALUES ('tg1', ?, 'tl1', 'General', 0, ?, ?)").bind(M, T, T).run();
    const todo = async (title: string, day: string | null, done: string | null = null) => {
      const tid = id();
      await env.DB.prepare('INSERT INTO todos (id, mode, list_id, group_id, title, day, done, ord, created, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)').bind(tid, M, 'tl1', 'tg1', title, day, done, T, T).run();
      return tid;
    };
    const any = await todo('Buy stamps', null);
    const old = await todo('Old one', '2026-11-10');
    await todo('Old and done', '2026-11-10', '2026-11-11');
    const mon = await todo('Monday thing', '2026-11-16');
    await scheduleTodo(ctx, any, '2026-11-20');
    const p = await weekPlan(at(WED, M), 'this');
    expect(p.days[4].todos.map((t) => t.title)).toEqual(['Buy stamps']);
    expect(p.days[0].todos.map((t) => t.id)).toEqual([mon]);
    expect(p.unscheduled).toEqual([]);
    expect(p.earlier.map((t) => t.id)).toEqual([old]);
    // Next week's view also offers this week's past open to-dos as "earlier".
    expect((await weekPlan(at(WED, M), 'next')).earlier.map((t) => t.id)).toEqual([old, mon]);
    await scheduleTodo(at(WED, M), any, null);
    expect((await weekPlan(at(WED, M), 'this')).unscheduled.map((t) => t.id)).toEqual([any]);
    await expect(scheduleTodo(at(WED, M), any, 'Friday')).rejects.toThrow(/date like/);
  });
});

describe('away days lower daily targets (flag away-lowers-targets)', () => {
  const lvl = (t: string) => parseLevel(t)!;
  const row = (day: string, count = 1) => ({ id: day, habit_id: 'h', kind: 'done', day, count }) as any;
  // Week of Monday 2 Nov; Saturday 7 and Sunday 8 away.
  const away = (d: string) => d === '2026-11-07' || d === '2026-11-08';
  const done = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'].map((d) => row(d));

  it('step-up maths: away days leave the target, and sessions on them are extra', () => {
    expect(weeksMet(lvl('1 a day'), ['2026-11-02'], done)).toEqual({ weeks: 1, done: 5, target: 7 });
    expect(weeksMet(lvl('1 a day'), ['2026-11-02'], done, away)).toEqual({ weeks: 1, done: 5, target: 5 });
    expect(weeksMet(lvl('1 a day'), ['2026-11-02'], [...done, row('2026-11-07')], away)).toEqual({ weeks: 1, done: 5, target: 5 });
    expect(weeksMet(lvl('2 a day'), ['2026-11-02', '2026-11-09'], done, away)).toEqual({ weeks: 2, done: 5, target: 10 + 14 }); // only the first week has away days
    // Weekly habits keep their target.
    expect(weeksMet(lvl('3 a week'), ['2026-11-02'], done, away)).toEqual({ weeks: 1, done: 3, target: 3 });
  });

  it('Insights: an away day asks nothing of a daily habit', () => {
    const habit = { id: 'h', per: 'day', sessions: 1 } as any;
    const input = { habit, history: [{ day: '2026-10-01', level: lvl('1 a day') }], pauses: [], rows: done, start: '2026-10-01' };
    expect(habitWeek(input, '2026-11-02', '2026-11-18')).toMatchObject({ target: 7, counted: 5, status: 'short' });
    expect(habitWeek({ ...input, away }, '2026-11-02', '2026-11-18')).toMatchObject({ target: 5, counted: 5, status: 'met' });
  });

  it('Plan my week: a daily habit’s week leaves out away days while the flag is on', async () => {
    const M = 'away1';
    await setting(M, 'rotation.saturday', 'away');
    await setting(M, 'rotation.sunday', 'away');
    const d = await habit(M, { name: 'Stretch', sessions: 2, per: 'day' });
    const w = await habit(M, { name: 'Swim', sessions: 2, per: 'week' });
    const late = await habit(M, { name: 'New', sessions: 1, per: 'day', started: '2026-11-19' });
    let p = await weekPlan(at(WED, M), 'this');
    const by = (x: string) => p.habits.find((h) => h.id === x)!;
    expect(p.away_lowers_targets).toBe(true);
    expect(by(d)).toMatchObject({ target: 10, away_days_left_out: 2 });
    expect(by(w)).toMatchObject({ target: 2, away_days_left_out: 0 });
    expect(by(late)).toMatchObject({ target: 2, away_days_left_out: 2 }); // Thu and Fri
    // A this-week change to the rotation counts too.
    await setLead(at(WED, M), '2026-11-20', 'away');
    p = await weekPlan(at(WED, M), 'this');
    expect(by(d).target).toBe(8);
    // Flag off: the full week.
    const ctx = at(WED, M);
    await setFeature(ctx, 'away-lowers-targets', false);
    try {
      p = await weekPlan(at(WED, M), 'this');
      expect(by(d)).toMatchObject({ target: 14, away_days_left_out: 0 });
      expect(p.away_lowers_targets).toBe(false);
    } finally {
      await setFeature(at(WED, M), 'away-lowers-targets', true);
    }
  });
});

describe('REST, Claude tools and the flag', () => {
  it('plans through REST and the tools', async () => {
    const plan = await call('GET', '/plan');
    const today = plan.today;
    const h = await call('POST', '/habits', { name: 'Tool habit', sessions: 2, per: 'week' });
    expect((await call('POST', '/plan/sessions', { habit_id: h.id, day: today })).planned).toBe(1);
    expect((await tool('plan_habit_session', { habit_id: h.id, day: today, count: 2 })).planned).toBe(3);
    expect((await tool('unplan_habit_session', { habit_id: h.id, day: today })).planned).toBe(2);
    expect((await tool('unplan_habit_session', { habit_id: h.id, day: today, all: true })).planned).toBe(0);
    expect(await toolError('plan_habit_session', { habit_id: h.id, day: addDays(today, -1) })).toMatch(/today and later/);
    const t = await tool('add_todo', { title: 'Post the letter' });
    const next = await tool('get_week_plan', { week: 'next' });
    expect(await tool('schedule_todo', { id: t.id, day: next.week_of })).toMatchObject({ day: next.week_of });
    expect((await tool('get_week_plan', { week: 'next' })).days[0].todos.map((x: any) => x.title)).toContain('Post the letter');
    expect((await tool('set_day_lead', { day: next.end, value: 'away' })).value).toBe('away');
    expect((await call('GET', '/plan?week=next')).days[6].away).toBe(true);
    expect((await call('PUT', '/plan/lead', { day: next.end, value: null })).changed).toBe(false);
    // Undo takes the planned session back.
    await call('POST', '/plan/sessions', { habit_id: h.id, day: today });
    await call('POST', '/undo');
    expect((await call('GET', '/plan')).habits.find((x: any) => x.id === h.id).planned).toBe(0);
  });

  it('hides the tools and routes while plan-week is off', async () => {
    await flagEverywhere('plan-week', false);
    try {
      const names = (await mcp<any>('tools/list')).tools.map((t: any) => t.name);
      for (const n of ['get_week_plan', 'plan_habit_session', 'unplan_habit_session', 'schedule_todo', 'set_day_lead']) expect(names).not.toContain(n);
      await call('GET', '/plan', undefined, { expect: 404 });
    } finally {
      await flagEverywhere('plan-week', true);
    }
    const names = (await mcp<any>('tools/list')).tools.map((t: any) => t.name);
    expect(names).toContain('get_week_plan');
  });

  it('a day of next week is shown from the owner’s Monday', async () => {
    const r = await loadRotation(at(WED, 'any-mode'));
    expect([r.today, r.this_monday, r.next_monday]).toEqual(['2026-11-18', '2026-11-16', '2026-11-23']);
  });
});
