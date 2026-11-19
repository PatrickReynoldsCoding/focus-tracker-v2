import { describe, expect, it } from 'vitest';
import { addDays } from '../src/core/ctx';
import { fullWeeks, isMet, mondayOf, pauseIntervals, weeksMet } from '../src/modules/habits';
import { atGoal, formatLevel, nextSteps, parseLevel, stepsToGoal, suggestStart } from '../src/core/habit-levels';
import { call, tool, toolError } from './helpers';

const L = (text: string) => parseLevel(text)!;
const row = (kind: string, day: string, count = 1, habit_id = 'h') => ({ id: `${kind}${day}`, habit_id, kind, day, count }) as any;

describe('habit levels (maths)', () => {
  it('reads and writes levels the v1 way', () => {
    expect(parseLevel('4 a week, 30 min')).toEqual({ sessions: 4, per: 'week', size: 30, unit: 'min' });
    expect(parseLevel('2 per day, 20 minutes')).toMatchObject({ sessions: 2, per: 'day', size: 20, unit: 'min' });
    expect(parseLevel('3', 'week')).toMatchObject({ sessions: 3, per: 'week', size: null });
    expect(parseLevel('run a 5k')).toBeNull();
    expect(formatLevel(L('1 a day, 2 km'))).toBe('1 a day, 2 km');
  });

  it('suggests a start at a third of the sessions and half the size', () => {
    expect(formatLevel(suggestStart(L('5 a week, 30 min')))).toBe('2 a week, 15 min');
    expect(formatLevel(suggestStart(L('1 a day, 10 min')))).toBe('1 a day, 5 min');
    expect(formatLevel(suggestStart(L('7 a week')))).toBe('2 a week');
    expect(formatLevel(suggestStart(L('1 a week, 5 min')))).toBe('1 a week, 5 min');
  });

  it('steps one at a time and never past the goal', () => {
    const goal = L('4 a week, 40 min');
    const s = nextSteps(L('2 a week, 20 min'), goal);
    expect(s.options.map((o) => o.text)).toEqual(['3 a week, 20 min', '2 a week, 25 min']);
    expect(s.suggested).toBe(1); // size has three steps left, sessions two
    expect(nextSteps(L('4 a week, 35 min'), goal).options.map((o) => o.text)).toEqual(['4 a week, 40 min']);
    expect(nextSteps(L('3 a week, 40 min'), goal).options.map((o) => o.text)).toEqual(['4 a week, 40 min']);
    expect(atGoal(L('4 a week, 40 min'), goal)).toBe(true);
    const path = stepsToGoal(L('2 a week, 15 min'), goal).map(formatLevel);
    expect(path[0]).toBe('2 a week, 15 min');
    expect(path.at(-1)).toBe('4 a week, 40 min');
    for (const p of path) expect(parseLevel(p)!.size!).toBeLessThanOrEqual(40);
  });
});

describe('step-up eligibility (maths)', () => {
  const mon = '2026-11-02'; // a Monday

  it('counts only full weeks since the change', () => {
    expect(mondayOf('2026-11-18')).toBe('2026-11-16');
    // Level changed on Monday 2 Nov, today Wednesday 18 Nov: weeks of 2, 9 (the 16th is not over)
    expect(fullWeeks(mon, '2026-11-18', [])).toEqual(['2026-11-02', '2026-11-09']);
    // Changed mid-week (Wednesday 4 Nov): the first full week is the 9th
    expect(fullWeeks('2026-11-04', '2026-11-18', [])).toEqual(['2026-11-09']);
    // On the Monday itself last week is over
    expect(fullWeeks(mon, '2026-11-16', [])).toEqual(['2026-11-02', '2026-11-09']);
    // Changed this week: nothing to judge yet
    expect(fullWeeks('2026-11-16', '2026-11-18', [])).toEqual([]);
  });

  it('leaves paused weeks out', () => {
    const pauses = pauseIntervals([row('pause', '2026-11-11'), row('resume', '2026-11-12')], '2026-11-18');
    expect(pauses).toEqual([{ from: '2026-11-11', to: '2026-11-11' }]);
    expect(fullWeeks(mon, '2026-11-18', pauses)).toEqual(['2026-11-02']);
    // A pause that is still open runs to today
    expect(pauseIntervals([row('pause', '2026-11-10')], '2026-11-18')).toEqual([{ from: '2026-11-10', to: '2026-11-18' }]);
    // A pause that ended before the week leaves it in
    expect(fullWeeks(mon, '2026-11-18', pauseIntervals([row('pause', '2026-10-20'), row('resume', '2026-11-02')], '2026-11-18'))).toEqual(['2026-11-02', '2026-11-09']);
  });

  it('is met at about 80 % of the sessions', () => {
    const lvl = L('5 a week');
    const four = [row('done', '2026-11-02', 2), row('done', '2026-11-04', 2)];
    expect(weeksMet(lvl, ['2026-11-02'], four)).toEqual({ weeks: 1, done: 4, target: 5 });
    expect(isMet(weeksMet(lvl, ['2026-11-02'], four))).toBe(true);
    expect(isMet(weeksMet(lvl, ['2026-11-02'], [row('done', '2026-11-02', 3)]))).toBe(false);
    // Across two weeks: 4 + 4 of 10 is met, 4 + 3 is not
    const two = [...four, row('done', '2026-11-09', 4)];
    expect(isMet(weeksMet(lvl, ['2026-11-02', '2026-11-09'], two))).toBe(true);
    expect(isMet(weeksMet(lvl, ['2026-11-02', '2026-11-09'], [...four, row('done', '2026-11-09', 3)]))).toBe(false);
  });

  it('does not let one big week hide an empty one, and never counts no weeks as met', () => {
    const lvl = L('3 a week');
    const m = weeksMet(lvl, ['2026-11-02', '2026-11-09'], [row('done', '2026-11-02', 9)]);
    expect(m).toEqual({ weeks: 2, done: 3, target: 6 });
    expect(isMet(m)).toBe(false);
    expect(isMet(weeksMet(lvl, [], []))).toBe(false);
  });

  it('caps a daily habit at its target per day', () => {
    const lvl = L('2 a day');
    const m = weeksMet(lvl, ['2026-11-02'], [row('done', '2026-11-02', 6), row('done', '2026-11-03', 2)]);
    expect(m).toEqual({ weeks: 1, done: 4, target: 14 });
  });
});

async function clean() {
  for (const h of await call('GET', '/habits')) await call('DELETE', `/habits/${h.id}`);
  for (const mode of ['personal']) await call('PUT', '/features/habit-step-up', { enabled: true }, { mode });
}

async function today() {
  return (await call('GET', '/today')).day as string;
}

const progress = async (id: string, day?: string) => (await call('GET', `/habits/progress${day ? `?day=${day}` : ''}`)).find((p: any) => p.id === id);

/** A weekly habit "Run" at 2 a week, 20 min with a goal of 4 a week, 40 min; its level has applied for `weeks` weeks. */
async function runner(weeks: number, doneEachWeek: number, extra: Record<string, unknown> = {}) {
  const t = await today();
  const monday = mondayOf(t);
  const h = await call('POST', '/habits', { name: 'Run', sessions: 2, per: 'week', size: '20 min', goal: '4 a week, 40 min', step_up_every: '1 week', ...extra });
  const [lvl] = await call('GET', `/habit_log?habit_id=${h.id}&kind=level`);
  await call('PATCH', `/habit_log/${lvl.id}`, { day: addDays(monday, -7 * weeks) });
  for (let w = 1; w <= weeks; w++) {
    for (let i = 0; i < doneEachWeek; i++) await call('POST', '/habit_log', { habit_id: h.id, day: addDays(monday, -7 * w + i), kind: 'done', count: 1 });
  }
  await call('PATCH', `/habits/${h.id}`, { next_prompt: `${addDays(t, -1)}T00:00:00.000Z` });
  return { h, t, monday };
}

describe('step-up prompts', () => {
  it('makes the first level row and the first prompt date when a habit is made', async () => {
    await clean();
    const t = await today();
    const h = await call('POST', '/habits', { name: 'Run', sessions: 2, per: 'week', size: '20 min', goal: '4 a week, 40 min', step_up_every: '2 weeks' });
    expect(h.next_prompt.slice(0, 10)).toBe(addDays(t, 14));
    expect(h.prompts).toBe('on');
    const levels = await call('GET', `/habit_log?habit_id=${h.id}&kind=level`);
    expect(levels).toHaveLength(1);
    expect(levels[0]).toMatchObject({ day: mondayOf(t), value: '2 a week, 20 min' });
    // Not due yet: no prompt
    expect((await progress(h.id)).step_up).toBeNull();
  });

  it('offers a step when the level was met, and "yes" waits for Accept', async () => {
    await clean();
    const { h, t, monday } = await runner(3, 2);
    const p = await progress(h.id);
    expect(p.step_up).toMatchObject({ current: '2 a week, 20 min', goal: '4 a week, 40 min', suggested: 1, weeks: { weeks: 3, done: 6, target: 6 } });
    expect(p.step_up.options.map((o: any) => o.text)).toEqual(['3 a week, 20 min', '2 a week, 25 min']);

    const r = await call('POST', `/habits/${h.id}/step-up`, { answer: 'yes', option: 'sessions' });
    expect(r.pending).toMatchObject({ day: addDays(monday, 7), text: '3 a week, 20 min', due: false });
    // Nothing about the habit changed yet, and the next prompt moved on by the pace
    const after = await call('GET', `/habits/${h.id}`);
    expect(after).toMatchObject({ sessions: 2, size: '20 min' });
    expect(after.next_prompt.slice(0, 10)).toBe(addDays(t, 7));
    const p2 = await progress(h.id);
    expect(p2.step_up).toBeNull();
    expect(p2.pending).toMatchObject({ text: '3 a week, 20 min', due: false });
    expect(await call('GET', `/habit_log?habit_id=${h.id}&kind=answer`)).toMatchObject([{ day: t, value: 'yes' }]);

    // Accepting before it is due is refused
    await call('POST', `/habits/${h.id}/pending`, { answer: 'accept' }, { expect: 400 });
    // "Not yet" moves it to next Monday again
    const later = await call('POST', `/habits/${h.id}/pending`, { answer: 'not yet' });
    expect(later.pending.day).toBe(addDays(monday, 7));

    // Next Monday comes: make it due, then accept
    const pend = (await call('GET', `/habit_log?habit_id=${h.id}&kind=pending`))[0];
    await call('PATCH', `/habit_log/${pend.id}`, { day: t });
    expect((await progress(h.id)).pending.due).toBe(true);
    const acc = await call('POST', `/habits/${h.id}/pending`, { answer: 'accept' });
    expect(acc.habit).toMatchObject({ sessions: 3, size: '20 min' });
    expect(await call('GET', `/habit_log?habit_id=${h.id}&kind=pending`)).toEqual([]);
    const levels = await call('GET', `/habit_log?habit_id=${h.id}&kind=level`);
    expect(levels.map((l: any) => [l.day, l.value]).sort()).toEqual([
      [addDays(monday, -21), '2 a week, 20 min'],
      [monday, '3 a week, 20 min'],
    ]);
  });

  it('compares past weeks with the level that applied then', async () => {
    await clean();
    const { h, monday } = await runner(3, 2);
    await call('POST', `/habits/${h.id}/step-up`, { answer: 'yes', option: 'sessions' });
    const pend = (await call('GET', `/habit_log?habit_id=${h.id}&kind=pending`))[0];
    await call('PATCH', `/habit_log/${pend.id}`, { day: monday });
    await call('POST', `/habits/${h.id}/pending`, { answer: 'accept' });
    expect(await progress(h.id)).toMatchObject({ target: 3, level: '3 a week, 20 min' });
    // Last week is still judged against 2 a week; the week before that too
    expect(await progress(h.id, addDays(monday, -3))).toMatchObject({ target: 2, done_this_period: 2, left: 0, level: '2 a week, 20 min' });
    expect(await progress(h.id, addDays(monday, -10))).toMatchObject({ target: 2, done_this_period: 2 });
  });

  it('does not prompt when the level was not met, or before a full week, or past the goal', async () => {
    await clean();
    const weak = await runner(3, 1); // 3 of 6 sessions
    expect((await progress(weak.h.id)).step_up).toBeNull();
    await clean();
    const fresh = await runner(0, 0); // changed this week: no full week yet
    expect((await progress(fresh.h.id)).step_up).toBeNull();
    await clean();
    const done = await runner(2, 2, { sessions: 4, size: '40 min' });
    expect((await progress(done.h.id)).step_up).toBeNull(); // already at 4 a week, 40 min
  });

  it('leaves paused weeks out of the count', async () => {
    await clean();
    // Three weeks, only the middle one is empty, and the habit was paused through it.
    const { h, monday } = await runner(3, 2);
    for (const l of await call('GET', `/habit_log?habit_id=${h.id}&kind=done`)) {
      if (l.day >= addDays(monday, -14) && l.day < addDays(monday, -7)) await call('DELETE', `/habit_log/${l.id}`);
    }
    expect((await progress(h.id)).step_up).toBeNull(); // 4 of 6 would still be 67 %
    await call('POST', '/habit_log', { habit_id: h.id, day: addDays(monday, -13), kind: 'pause' });
    await call('POST', '/habit_log', { habit_id: h.id, day: addDays(monday, -8), kind: 'resume' });
    const p = await progress(h.id);
    expect(p.step_up.weeks).toEqual({ weeks: 2, done: 4, target: 4 });
  });

  it('records a pause and a resume when the status changes', async () => {
    await clean();
    const h = await call('POST', '/habits', { name: 'Read', sessions: 1, per: 'day' });
    await call('PATCH', `/habits/${h.id}`, { status: 'paused' });
    await call('PATCH', `/habits/${h.id}`, { status: 'active' });
    const kinds = (await call('GET', `/habit_log?habit_id=${h.id}`)).map((l: any) => l.kind);
    expect(kinds).toEqual(expect.arrayContaining(['pause', 'resume', 'level']));
  });

  it('"not now" pushes the prompt by the pace, and three in a row ask whether to stop', async () => {
    await clean();
    const { h, t } = await runner(3, 2);
    for (let i = 0; i < 3; i++) {
      const p = await progress(h.id);
      expect(p.step_up).not.toBeNull();
      const r = await call('POST', `/habits/${h.id}/step-up`, { answer: 'not now' });
      expect(r.habit.next_prompt.slice(0, 10)).toBe(addDays(t, 7));
      // Pretend a day has gone by: move the answer back and make the prompt due again
      const [a] = await call('GET', `/habit_log?habit_id=${h.id}&kind=answer`);
      await call('PATCH', `/habit_log/${a.id}`, { day: addDays(t, -10 + i) });
      await call('PATCH', `/habits/${h.id}`, { next_prompt: `${addDays(t, -1)}T00:00:00.000Z` });
    }
    const p = await progress(h.id);
    expect(p.ask_stop).toBe(true);
    expect(p.step_up).toBeNull();
    const r = await call('POST', `/habits/${h.id}/step-up`, { answer: 'stop asking' });
    expect(r.habit).toMatchObject({ prompts: 'off', next_prompt: null });
    expect((await progress(h.id)).ask_stop).toBe(false);
  });

  it('allows one prompt a day', async () => {
    await clean();
    const a = await runner(3, 2);
    const t = a.t;
    const b = (await call('POST', '/habits', { name: 'Walk', sessions: 2, per: 'week', size: '20 min', goal: '4 a week, 40 min', step_up_every: '1 week' }));
    const [lvl] = await call('GET', `/habit_log?habit_id=${b.id}&kind=level`);
    await call('PATCH', `/habit_log/${lvl.id}`, { day: addDays(a.monday, -21) });
    for (let w = 1; w <= 3; w++) for (let i = 0; i < 2; i++) await call('POST', '/habit_log', { habit_id: b.id, day: addDays(a.monday, -7 * w + i), kind: 'done' });
    await call('PATCH', `/habits/${b.id}`, { next_prompt: `${addDays(t, -1)}T00:00:00.000Z` });
    let prog = await call('GET', '/habits/progress');
    expect(prog.filter((p: any) => p.step_up).map((p: any) => p.name)).toEqual(['Run']); // the first, in the owner's order
    await call('POST', `/habits/${a.h.id}/step-up`, { answer: 'not now' });
    prog = await call('GET', '/habits/progress');
    expect(prog.filter((p: any) => p.step_up)).toEqual([]); // answered one today: no second prompt
  });

  it('"at goal" stops the prompts and sets the goal to where the habit is', async () => {
    await clean();
    const { h } = await runner(3, 2);
    const r = await call('POST', `/habits/${h.id}/step-up`, { answer: 'at goal' });
    expect(r.habit).toMatchObject({ prompts: 'at goal', goal: '2 a week, 20 min', next_prompt: null });
    expect((await progress(h.id)).step_up).toBeNull();
  });

  it('editing the level by hand writes a level row and drops a waiting change', async () => {
    await clean();
    const { h, monday } = await runner(3, 2);
    await call('POST', `/habits/${h.id}/step-up`, { answer: 'yes' });
    expect(await call('GET', `/habit_log?habit_id=${h.id}&kind=pending`)).toHaveLength(1);
    await call('PATCH', `/habits/${h.id}`, { sessions: 3 });
    expect(await call('GET', `/habit_log?habit_id=${h.id}&kind=pending`)).toEqual([]);
    expect((await call('GET', `/habit_log?habit_id=${h.id}&kind=level`)).map((l: any) => l.day)).toContain(monday);
    expect(await progress(h.id)).toMatchObject({ target: 3 });
  });

  it('can be switched off with the habit-step-up flag', async () => {
    await clean();
    const { h } = await runner(3, 2);
    await call('PUT', '/features/habit-step-up', { enabled: false });
    expect((await progress(h.id)).step_up).toBeNull();
    await call('POST', `/habits/${h.id}/step-up`, { answer: 'yes' }, { expect: 404 });
    expect(await toolError('answer_step_up', { id: h.id, answer: 'yes' })).toMatch(/Unknown tool|turned off/i);
    await call('PUT', '/features/habit-step-up', { enabled: true });
  });
});

describe('recording days', () => {
  it('records today and up to 7 days back, not further and not in the future', async () => {
    await clean();
    const t = await today();
    const h = await call('POST', '/habits', { name: 'Stretch', sessions: 1, per: 'day' });
    await call('POST', `/habits/${h.id}/check`, { day: addDays(t, -3) });
    await call('POST', `/habits/${h.id}/check`, { day: addDays(t, -7) });
    await call('POST', `/habits/${h.id}/check`, { day: addDays(t, -8) }, { expect: 400 });
    await call('POST', `/habits/${h.id}/check`, { day: addDays(t, 1) }, { expect: 400 });
    await call('POST', `/habits/${h.id}/check`, { day: addDays(t, -2), count: 2 });
    const p = await progress(h.id);
    expect(p.days).toHaveLength(7);
    expect(p.days.at(-1)).toMatchObject({ day: t, count: 0, future: false });
    expect(p.days.find((d: any) => d.day === addDays(t, -3))!.count).toBe(1);
    expect(p.days.find((d: any) => d.day === addDays(t, -2))!.count).toBe(2);
    await call('POST', `/habits/${h.id}/check`, { day: addDays(t, -3), add: -1 });
    expect((await progress(h.id)).days.find((d: any) => d.day === addDays(t, -3))!.count).toBe(0);
  });

  it('shows the week for a weekly habit, with later days marked as future', async () => {
    await clean();
    const t = await today();
    const h = await call('POST', '/habits', { name: 'Swim', sessions: 3, per: 'week' });
    const p = await progress(h.id);
    expect(p.days.map((d: any) => d.day)[0]).toBe(mondayOf(t));
    expect(p.days.filter((d: any) => d.future).every((d: any) => d.day > t)).toBe(true);
    expect(p.days).toHaveLength(7);
  });
});

describe('aspiring habits', () => {
  it('are noted with a name only, kept off Today, and started with a level row', async () => {
    await clean();
    const t = await today();
    const a = await call('POST', '/habits', { name: 'Learn to juggle', status: 'aspiring' });
    expect(a.status).toBe('aspiring');
    expect(a.started ?? null).toBeNull();
    expect(a.next_prompt ?? null).toBeNull();
    expect(await call('GET', `/habit_log?habit_id=${a.id}`)).toEqual([]);
    expect((await call('GET', '/habits/progress')).find((p: any) => p.id === a.id)).toBeUndefined();
    expect((await call('GET', '/today')).habits.find((p: any) => p.id === a.id)).toBeUndefined();

    const started = await call('PATCH', `/habits/${a.id}`, { status: 'active', sessions: 1, per: 'day', size: '5 min', goal: '1 a day, 15 min', step_up_every: '2 weeks' });
    expect(started).toMatchObject({ status: 'active', started: t });
    expect(started.next_prompt.slice(0, 10)).toBe(addDays(t, 14));
    expect((await call('GET', `/habit_log?habit_id=${a.id}&kind=level`))[0]).toMatchObject({ day: t, value: '1 a day, 5 min' });
    expect((await call('GET', '/today')).habits.find((p: any) => p.id === a.id)).toBeDefined();
  });

  it('can be reordered with move', async () => {
    await clean();
    const x = await call('POST', '/habits', { name: 'A', status: 'aspiring' });
    const y = await call('POST', '/habits', { name: 'B', status: 'aspiring' });
    await call('POST', `/habits/${y.id}/move`, { before_id: x.id });
    expect((await call('GET', '/habits')).map((h: any) => h.name)).toEqual(['B', 'A']);
  });
});

describe('Claude tools', () => {
  it('adds an aspiring habit, reviews step-ups and answers them', async () => {
    await clean();
    const a = await tool('add_aspiring_habit', { name: 'Meditate', description: 'to feel calmer' });
    expect(a).toMatchObject({ status: 'aspiring', description: 'to feel calmer' });
    const { h } = await runner(3, 2);
    const review = (await tool('habit_step_ups')).find((r: any) => r.id === h.id);
    expect(review).toMatchObject({ level_met: true, prompt_due: true, full_weeks_counted: 3, sessions_done: 6, sessions_target: 6 });
    const yes = await tool('answer_step_up', { id: h.id, answer: 'yes', option: 'size' });
    expect(yes.pending.text).toBe('2 a week, 25 min');
    const prog = (await tool('habit_progress')).find((p: any) => p.id === h.id);
    expect(prog.pending.text).toBe('2 a week, 25 min');
    expect(await toolError('answer_pending_level', { id: h.id, answer: 'accept' })).toMatch(/not due/);
    const pend = (await call('GET', `/habit_log?habit_id=${h.id}&kind=pending`))[0];
    await call('PATCH', `/habit_log/${pend.id}`, { day: await today() });
    const acc = await tool('answer_pending_level', { id: h.id, answer: 'accept' });
    expect(acc.habit).toMatchObject({ sessions: 2, size: '25 min' });
  });
});

describe('step-up notifications', () => {
  it('only notify when the level was met, and go away once answered', async () => {
    await clean();
    await runner(3, 1); // not met: nothing to ask
    const good = await runner(3, 2, { name: 'Walk' });
    const pending = async () => (await call('GET', '/notifications/pending')).filter((n: any) => n.kind === 'habit');
    const list = await pending();
    expect(list.map((n: any) => n.title)).toEqual(['Walk']);
    expect(list[0].body).toMatch(/Want to go further\? Next step: /);
    await call('POST', `/habits/${good.h.id}/step-up`, { answer: 'not now' });
    expect(await pending()).toEqual([]);
  });
});
