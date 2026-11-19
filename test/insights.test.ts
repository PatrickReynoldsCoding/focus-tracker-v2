// Insights: the weeks' maths (Monday to Sunday in the owner's time zone), habits against the level that
// applied then, projects, logs, the Claude tool and the flag. Rows are written straight to the database.
import { env } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Ctx } from '../src/core/ctx';
import { habitWeek, habitsHistory, logLines, projectsInsight, weekStarts, weekSummary } from '../src/modules/insights';
import { call, mcp, tool } from './helpers';

const T = '2026-11-18T00:00:00.000Z';
let n = 0;
const id = () => `i${++n}`;

async function habit(mode: string, h: { name: string; sessions: number; per: 'day' | 'week'; started: string; status?: string; size?: string }) {
  const hid = id();
  await env.DB.prepare('INSERT INTO habits (id, mode, name, sessions, per, size, status, started, ord, created, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)')
    .bind(hid, mode, h.name, h.sessions, h.per, h.size ?? null, h.status ?? 'active', h.started, T, T)
    .run();
  return hid;
}
async function hlog(mode: string, habit_id: string, day: string, kind: string, count = 1, value: string | null = null) {
  await env.DB.prepare('INSERT INTO habit_log (id, mode, habit_id, day, kind, count, value, created, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id(), mode, habit_id, day, kind, count, value, T, T)
    .run();
}
async function project(mode: string, name: string, status: string, last: string | null) {
  const pid = id();
  await env.DB.prepare('INSERT INTO projects (id, mode, name, status, last_touched, ord, created, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)').bind(pid, mode, name, status, last, T, T).run();
  return pid;
}
async function session(mode: string, project_id: string | null, date: string, minutes: number | null, where = 'stopped') {
  await env.DB.prepare('INSERT INTO log (id, mode, project_id, date, minutes, where_stopped, created, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id(), mode, project_id, date, minutes, where, `${date}T10:00:00.000Z`, T)
    .run();
}
async function todo(mode: string, day: string | null, done: string | null) {
  await env.DB.prepare('INSERT INTO todos (id, mode, list_id, title, day, done, ord, created, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)').bind(id(), mode, 'l', 'x', day, done, T, T).run();
}
async function skip(mode: string, project_id: string, date: string) {
  await env.DB.prepare('INSERT INTO skips (id, mode, project_id, date, created, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id(), mode, project_id, date, T, T).run();
}

// Sunday 22 Nov 2026, 23:30 UTC is already Monday 23 Nov 12:30 in Auckland: a new week has begun there.
const NOW = new Date('2026-11-22T23:30:00.000Z');
const M = 'itest';
const ctxFor = (mode: string) => new Ctx(env as any, mode, NOW);
const ids: Record<string, string> = {};

beforeAll(async () => {
  await env.DB.prepare("INSERT OR REPLACE INTO settings (mode, key, value, updated_at) VALUES ('', 'timezone', 'Pacific/Auckland', ?)").bind(T).run();

  // Run: weekly, 2 a week from 12 Oct, 3 a week from 2 Nov
  ids.run = await habit(M, { name: 'Run', sessions: 3, per: 'week', started: '2026-10-12', size: '20 min' });
  await hlog(M, ids.run, '2026-10-12', 'level', 2, '2 a week, 20 min');
  await hlog(M, ids.run, '2026-11-02', 'level', 3, '3 a week, 20 min');
  for (const [d, c] of [['2026-10-12', 1], ['2026-10-14', 1], ['2026-10-20', 1], ['2026-10-27', 1], ['2026-10-29', 1], ['2026-11-03', 2], ['2026-11-05', 1], ['2026-11-06', 1], ['2026-11-10', 1], ['2026-11-12', 1], ['2026-11-16', 1], ['2026-11-18', 1], ['2026-11-20', 1], ['2026-11-23', 1]] as const) await hlog(M, ids.run, d, 'done', c);
  await hlog(M, ids.run, '2026-11-26', 'plan', 2);

  // Stretch: 2 a day, started on Tuesday 10 Nov; a "not today" on Saturday 21 Nov
  ids.stretch = await habit(M, { name: 'Stretch', sessions: 2, per: 'day', started: '2026-11-10' });
  await hlog(M, ids.stretch, '2026-11-10', 'level', 2, '2 a day');
  for (const [d, c] of [['2026-11-10', 2], ['2026-11-16', 2], ['2026-11-17', 2], ['2026-11-18', 3], ['2026-11-19', 2], ['2026-11-20', 2]] as const) await hlog(M, ids.stretch, d, 'done', c);
  await hlog(M, ids.stretch, '2026-11-21', 'skip');

  // Read: weekly, paused for the weeks of 2 and 9 Nov
  ids.read = await habit(M, { name: 'Read', sessions: 2, per: 'week', started: '2026-10-26', status: 'paused' });
  await hlog(M, ids.read, '2026-10-26', 'level', 2, '2 a week');
  await hlog(M, ids.read, '2026-11-03', 'pause');
  await hlog(M, ids.read, '2026-11-12', 'resume');
  await hlog(M, ids.read, '2026-10-27', 'done', 2);

  // aspiring habits never show
  await habit(M, { name: 'Idea', sessions: 1, per: 'day', started: '2026-11-01', status: 'aspiring' });

  const a = (ids.a = await project(M, 'Alpha', 'active', '2026-11-20'));
  const b = (ids.b = await project(M, 'Beta', 'active', '2026-10-01'));
  ids.c = await project(M, 'Gamma', 'active', null);
  ids.d = await project(M, 'Delta', 'done', '2026-09-01');
  await session(M, a, '2026-11-17', 25);
  await session(M, a, '2026-11-20', 45, 'wrote tests');
  await session(M, b, '2026-11-21', null);
  await session(M, null, '2026-11-18', 30);
  await session(M, a, '2026-11-23', 30);
  await session(M, a, '2026-09-01', 60); // long ago
  await skip(M, b, '2026-11-18');
  await skip(M, b, '2026-09-02');
  await todo(M, '2026-11-18', '2026-11-18');
  await todo(M, '2026-11-18', '2026-11-19');
  await todo(M, null, '2026-11-23');
  await todo(M, '2026-11-23', null); // due today, still open
  await todo(M, '2026-11-25', null); // coming up
  await todo(M, '2026-11-10', null); // older, ignored by the week view
  // another mode's rows never leak in
  await session('other', null, '2026-11-23', 999);
});
afterAll(async () => {
  await env.DB.prepare("DELETE FROM settings WHERE mode = '' AND key = 'timezone'").run();
});

describe('weeks in the owner time zone', () => {
  it('starts the week on Monday, where it is Monday for the owner', async () => {
    const r = await weekSummary(ctxFor(M));
    expect(r.today).toBe('2026-11-23');
    expect(r.weeks.map((w) => w.start)).toEqual(['2026-11-23', '2026-11-16']);
    expect(r.weeks[0]).toMatchObject({ end: '2026-11-29', current: true });
    expect(weekStarts('2026-11-23', 3)).toEqual(['2026-11-09', '2026-11-16', '2026-11-23']);
    expect(weekStarts('2026-11-22', 2)).toEqual(['2026-11-09', '2026-11-16']); // Sunday is still the old week
  });

  it('sums focus sessions and minutes per week and day, for this mode only', async () => {
    const [cur, last] = (await weekSummary(ctxFor(M))).weeks;
    expect(cur.focus).toMatchObject({ sessions: 1, minutes: 30 });
    expect(last.focus).toMatchObject({ sessions: 4, minutes: 100 });
    expect(last.focus.days.map((d) => d.minutes)).toEqual([0, 25, 30, 0, 45, 0, 0]);
    expect(last.focus.days).toHaveLength(7);
  });

  it('counts to-dos done, still open and coming up, and skips', async () => {
    const [cur, last] = (await weekSummary(ctxFor(M))).weeks;
    expect(last.todos).toEqual({ done: 2, still_open: 0, coming_up: 0 });
    expect(cur.todos).toEqual({ done: 1, still_open: 1, coming_up: 1 });
    expect(last.skips).toBe(1);
    expect(cur.skips).toBe(0);
  });
});

describe('habits against the target that applied then', () => {
  it('weekly: uses the level of that week, shows extra apart, marks short weeks', async () => {
    const h = await habitsHistory(ctxFor(M), 8);
    expect(h.weeks[0]).toBe('2026-10-05');
    expect(h.weeks.at(-1)).toBe('2026-11-23');
    const run = h.habits.find((x) => x.name === 'Run')!;
    const by = Object.fromEntries(run.weeks.map((w) => [w.week, w]));
    expect(by['2026-10-05'].status).toBe('before'); // before it started
    expect(by['2026-10-12']).toMatchObject({ target: 2, done: 2, counted: 2, over: 0, status: 'met' });
    expect(by['2026-10-19']).toMatchObject({ target: 2, done: 1, status: 'short' });
    expect(by['2026-10-26']).toMatchObject({ target: 2, done: 2, status: 'met' });
    // from 2 Nov the target is 3: four sessions = 3 on target + 1 over
    expect(by['2026-11-02']).toMatchObject({ target: 3, done: 4, counted: 3, over: 1, status: 'met', level: '3 a week, 20 min' });
    expect(by['2026-11-09']).toMatchObject({ target: 3, done: 2, status: 'short' });
    expect(by['2026-11-16']).toMatchObject({ target: 3, done: 3, status: 'met' });
    expect(by['2026-11-23']).toMatchObject({ target: 3, done: 1, status: 'open', planned_later: 2 });
    expect(run.counted_weeks).toBe(6);
    expect(run.on_target_weeks).toBe(4);
    expect(run.level).toBe('3 a week, 20 min');
  });

  it('daily: each day against its own target, "not today" asks nothing, a part week is not counted', async () => {
    const stretch = (await habitsHistory(ctxFor(M), 4)).habits.find((x) => x.name === 'Stretch')!;
    const by = Object.fromEntries(stretch.weeks.map((w) => [w.week, w]));
    expect(by['2026-11-09']).toMatchObject({ status: 'partial', target: 12, done: 2 }); // Tue to Sun
    // 16th..20th: 2,2,3,2,2 done; 21st skipped (no target); 22nd asked 2, none done
    expect(by['2026-11-16']).toMatchObject({ target: 12, done: 11, counted: 10, over: 1, status: 'short' });
    expect(by['2026-11-02'].status).toBe('before');
    expect(stretch.counted_weeks).toBe(1);
    expect(stretch.on_target_weeks).toBe(0);
  });

  it('leaves paused weeks out and does not list aspiring habits', async () => {
    const h = await habitsHistory(ctxFor(M), 6);
    expect(h.habits.map((x) => x.name).sort()).toEqual(['Read', 'Run', 'Stretch']);
    const read = h.habits.find((x) => x.name === 'Read')!;
    const by = Object.fromEntries(read.weeks.map((w) => [w.week, w.status]));
    expect(by['2026-11-02']).toBe('paused');
    expect(by['2026-11-09']).toBe('paused');
    expect(by['2026-10-26']).toBe('met');
    expect(read.counted_weeks).toBe(2); // 26 Oct and 16 Nov (the 16th was not paused)
  });

  it('week view: totals leave paused habits out and carry "planned later"', async () => {
    const [cur, last] = (await weekSummary(ctxFor(M))).weeks;
    const run = cur.habits.find((h) => h.name === 'Run')!;
    expect(run).toMatchObject({ per: 'week', level: '3 a week, 20 min', done: 1, target: 3, planned_later: 2, status: 'open' });
    expect(last.habit_totals.over).toBe(1 + 0); // Stretch's extra session; Run met exactly
  });

  it('habitWeek works on plain data', () => {
    const habit = { id: 'h', per: 'week', sessions: 1, created: '2026-01-01T00:00:00Z' } as any;
    const input = { habit, history: [], pauses: [], rows: [{ habit_id: 'h', day: '2026-11-17', kind: 'done', count: 3 }] as any[], start: '2026-01-01' };
    expect(habitWeek(input, '2026-11-16', '2026-11-30')).toMatchObject({ target: 1, done: 3, counted: 1, over: 2, status: 'met' });
    expect(habitWeek(input, '2026-11-23', '2026-11-30')).toMatchObject({ done: 0, counted: 0, status: 'short' });
  });
});

describe('projects and logs', () => {
  it('sums per project in the range, with share, last touched, stale and skips', async () => {
    const r = await projectsInsight(ctxFor(M), 4); // from 2 Nov
    expect(r.from).toBe('2026-11-02');
    expect(r.total_sessions).toBe(5);
    expect(r.total_minutes).toBe(130);
    const by = Object.fromEntries(r.projects.map((p) => [p.name, p]));
    expect(by.Alpha).toMatchObject({ sessions: 3, minutes: 100, last_touched: '2026-11-20', days_since: 3, stale: false, skips: 0 });
    expect(by.Alpha.share).toBeCloseTo(100 / 130);
    expect(by.Beta).toMatchObject({ sessions: 1, minutes: 0, stale: true, skips: 1 }); // the September skip is outside the range
    expect(by.Gamma).toMatchObject({ sessions: 0, stale: true, last_touched: null });
    expect(by['No project']).toMatchObject({ sessions: 1, minutes: 30, id: null });
    expect(by.Delta).toBeUndefined(); // done, nothing in range
    expect(r.projects[0].name).toBe('Alpha');
    expect((await projectsInsight(ctxFor(M), 26)).projects.find((p) => p.name === 'Alpha')!.minutes).toBe(160);
  });

  it('lists log lines with project and date filters, and totals for the filter', async () => {
    const all = await logLines(ctxFor(M), {});
    expect(all.rows[0]).toMatchObject({ date: '2026-11-23', project_name: 'Alpha' });
    expect(all.sessions).toBe(6);
    const a = await logLines(ctxFor(M), { project: ids.a, from: '2026-11-01', to: '2026-11-22' });
    expect(a.rows.map((x) => x.date)).toEqual(['2026-11-20', '2026-11-17']);
    expect(a).toMatchObject({ sessions: 2, minutes: 70, has_more: false });
    expect((await logLines(ctxFor(M), { project: 'none' })).rows).toHaveLength(1);
    const paged = await logLines(ctxFor(M), { limit: 2 });
    expect(paged.rows).toHaveLength(2);
    expect(paged.has_more).toBe(true);
    await expect(logLines(ctxFor(M), { from: 'yesterday' })).rejects.toThrow(/from must be a date/);
  });
});

describe('empty data', () => {
  it('answers with zeros and empty lists', async () => {
    const c = ctxFor('nothing');
    const w = await weekSummary(c);
    expect(w.weeks).toHaveLength(2);
    expect(w.weeks[0]).toMatchObject({ focus: { sessions: 0, minutes: 0 }, habits: [], habit_totals: { counted: 0, target: 0, over: 0 }, todos: { done: 0, still_open: 0, coming_up: 0 }, skips: 0 });
    expect((await habitsHistory(c, 8)).habits).toEqual([]);
    expect(await projectsInsight(c, 4)).toMatchObject({ total_minutes: 0, total_sessions: 0, projects: [] });
    expect(await logLines(c, {})).toMatchObject({ rows: [], sessions: 0, minutes: 0, has_more: false });
  });
});

describe('REST, the Claude tool and the flag', () => {
  it('serves the four views and the tool, then hides them when the flag is off', async () => {
    const week = await call('GET', '/insights/week');
    expect(week.weeks).toHaveLength(2);
    expect((await call('GET', '/insights/habits?weeks=12')).weeks).toHaveLength(12);
    expect((await call('GET', '/insights/habits?weeks=999')).weeks).toHaveLength(26);
    expect((await call('GET', '/insights/projects')).weeks).toBe(4);
    expect(await call('GET', '/insights/logs?limit=5')).toHaveProperty('rows');
    await call('GET', '/insights/logs?from=nope', undefined, { expect: 400 });
    expect((await tool('insights', { view: 'projects', weeks: 12 })).weeks).toBe(12);
    expect((await tool('insights')).weeks).toHaveLength(2);
    expect((await tool('insights', { view: 'habits' })).weeks).toHaveLength(8);
    await call('PUT', '/features/insights', { enabled: false });
    try {
      await call('GET', '/insights/week', undefined, { expect: 404 });
      const tools = await mcp<any>('tools/list');
      expect(tools.tools.some((t: any) => t.name === 'insights')).toBe(false);
    } finally {
      await call('PUT', '/features/insights', { enabled: true });
    }
  });
});
