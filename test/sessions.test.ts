// Sessions: pause maths, the pomodoro that waits for a click, planned length,
// the notices they make, and the swap dialog's ranking and reminders.
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { pomodoroView, sessionNotices, workedSeconds, type StoredSession } from '../src/modules/sessions';
import { call, tool, flagEverywhere } from './helpers';

const M = { mode: 'work' };
const MIN = 60_000;

async function stored(): Promise<StoredSession> {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE mode = 'work' AND key = 'session.current'").first<{ value: string }>();
  return JSON.parse(r!.value);
}
async function write(s: StoredSession) {
  await env.DB.prepare("UPDATE settings SET value = ? WHERE mode = 'work' AND key = 'session.current'").bind(JSON.stringify(s)).run();
}
/** Pretend ms have passed: move every stored time back. */
async function pass(ms: number) {
  const s = await stored();
  const back = (t: string) => new Date(Date.parse(t) - ms).toISOString();
  await write({ ...s, started: back(s.started), paused_at: s.paused_at ? back(s.paused_at) : s.paused_at });
}
async function setFlag(id: string, on: boolean) {
  await flagEverywhere(id, on);
}

async function startOn(name: string, body: Record<string, unknown> = {}) {
  const p = await call('POST', '/projects', { name }, M);
  await call('PUT', '/focus', { project_id: p.id }, M);
  return { p, s: await call('POST', '/session/start', body, M) };
}

beforeEach(async () => {
  if (await call('GET', '/session', undefined, M)) await call('POST', '/session/stop', { discard: true }, M);
  await setFlag('pomodoro-waits-for-click', true);
});

describe('pause maths (pure)', () => {
  const t0 = Date.parse('2026-11-18T10:00:00.000Z');
  const base: StoredSession = { project_id: 'p', started: new Date(t0).toISOString(), pomodoro: null };

  it('leaves out finished and running pauses', () => {
    expect(workedSeconds(base, t0 + 10 * MIN)).toBe(600);
    expect(workedSeconds({ ...base, paused_ms: 3 * MIN }, t0 + 10 * MIN)).toBe(420);
    const paused = { ...base, paused_ms: 3 * MIN, paused_at: new Date(t0 + 8 * MIN).toISOString() };
    expect(workedSeconds(paused, t0 + 10 * MIN)).toBe(300);
    expect(workedSeconds(paused, t0 + 60 * MIN)).toBe(300); // frozen while paused
  });

  it('reads a session saved before pauses existed', () => {
    const old = { project_id: 'p', started: new Date(t0).toISOString(), pomodoro: { work: 25, break: 5 } };
    const v = pomodoroView(old, 26 * 60, t0, true)!;
    expect(v).toMatchObject({ phase: 'work', round: 1, seconds_left: 0, waiting: true, next_phase: 'break' });
    const cycling = pomodoroView(old, 26 * 60, t0, false)!;
    expect(cycling).toMatchObject({ phase: 'break', round: 1, seconds_left: 240, waiting: false });
  });

  it('dates a notice by when the period ended, not when it was seen', () => {
    const s: StoredSession = { ...base, pomodoro: { work: 25, break: 5 }, phase: 'work', phase_start: 0, round: 1 };
    const [n] = sessionNotices(s, t0 + 40 * MIN, true);
    expect(n).toMatchObject({ kind: 'pomodoro', title: 'Time for a break', due: new Date(t0 + 25 * MIN).toISOString() });
  });
});

describe('sessions over the API', () => {
  it('pauses and resumes; paused time is not counted', async () => {
    const { p } = await startOn('Pause me', { pomodoro: true, planned_min: 50 });
    await pass(10 * MIN);
    let s = await call('POST', '/session/pause', {}, M);
    expect(s.paused).toBe(true);
    expect(s.worked_seconds).toBeGreaterThanOrEqual(600);
    // Twenty minutes paused.
    await pass(20 * MIN);
    s = await call('GET', '/session', undefined, M);
    expect(s.worked_seconds).toBeLessThan(605);
    expect(s.elapsed_seconds).toBe(s.worked_seconds);
    expect(s.pomodoro).toMatchObject({ phase: 'work', paused: true });
    expect(s.pomodoro.seconds_left).toBeGreaterThan(14 * 60);
    expect(s.planned.seconds_left).toBeGreaterThan(39 * 60);
    expect((await call('POST', '/session/pause', {}, M)).paused).toBe(true); // twice is harmless
    s = await call('POST', '/session/resume', {}, M);
    expect(s.paused).toBe(false);
    await pass(5 * MIN);
    const status = await call('GET', '/status', undefined, M);
    expect(status.session).toMatchObject({ paused: false });
    expect(status.session.worked_seconds).toBeLessThan(15 * 60 + 5);
    const log = await call('POST', '/session/stop', { where_stopped: 'x' }, M);
    expect(log).toMatchObject({ project_id: p.id, minutes: 15 });
  });

  it('pomodoro waits for a click, then starts the next period', async () => {
    await startOn('Pomo wait', { pomodoro: true, planned_min: null });
    await pass(30 * MIN);
    let s = await call('GET', '/session', undefined, M);
    expect(s.pomodoro).toMatchObject({ phase: 'work', seconds_left: 0, waiting: true, next_phase: 'break', round: 1 });
    let st = await call('GET', '/status', undefined, M);
    expect(st.session.pomodoro).toMatchObject({ phase: 'work', seconds_left: 0, waiting: true });
    expect(st.notifications.map((n: any) => n.title)).toContain('Time for a break');
    // Start break.
    s = await call('POST', '/session/next', {}, M);
    expect(s.pomodoro).toMatchObject({ phase: 'break', waiting: false, round: 1 });
    expect(s.pomodoro.seconds_left).toBe(300);
    st = await call('GET', '/status', undefined, M);
    expect(st.notifications.map((n: any) => n.title)).not.toContain('Time for a break'); // cleared once acted on
    await pass(7 * MIN);
    s = await call('GET', '/session', undefined, M);
    expect(s.pomodoro).toMatchObject({ phase: 'break', waiting: true, next_phase: 'work' });
    st = await call('GET', '/status', undefined, M);
    expect(st.notifications.map((n: any) => n.title)).toContain('Break over');
    s = await call('POST', '/session/next', {}, M);
    expect(s.pomodoro).toMatchObject({ phase: 'work', round: 2, seconds_left: 1500 });
    // Breaks count as time worked.
    const log = await call('POST', '/session/stop', {}, M);
    expect(log.minutes).toBe(37);
  });

  it('cycles by itself when the flag is off', async () => {
    await setFlag('pomodoro-waits-for-click', false);
    await startOn('Pomo cycle', { pomodoro: true, planned_min: null });
    await pass(26 * MIN);
    const s = await call('GET', '/session', undefined, M);
    expect(s.pomodoro).toMatchObject({ phase: 'break', waiting: false });
    const st = await call('GET', '/status', undefined, M);
    expect(st.notifications.map((n: any) => n.title)).toContain('Break time');
    await call('POST', '/session/next', {}, M); // allowed, but the cycle wins when the flag is off
  });

  it('turns the pomodoro on and off per session', async () => {
    await startOn('Pomo off', { pomodoro: false, planned_min: null });
    let s = await call('GET', '/session', undefined, M);
    expect(s.pomodoro).toBeNull();
    await call('POST', '/session/next', {}, { ...M, expect: 400 });
    await pass(40 * MIN);
    s = await call('POST', '/session/pomodoro', { on: true }, M);
    expect(s.pomodoro).toMatchObject({ phase: 'work', seconds_left: 1500, waiting: false });
    s = await call('POST', '/session/pomodoro', { on: false }, M);
    expect(s.pomodoro).toBeNull();
  });

  it('plans a length, says when time is up, and keeps going', async () => {
    const st0 = await call('GET', '/session/state', undefined, M);
    await startOn('Planned', { pomodoro: false, planned_min: 50 });
    let state = await call('GET', '/session/state', undefined, M);
    expect(state.defaults.planned_min).toBe(50); // remembered
    expect(state.session.planned).toMatchObject({ minutes: 50, time_up: false });
    expect(st0.defaults.lengths).toEqual([25, 50, 90]);
    await pass(52 * MIN);
    let s = await call('GET', '/session', undefined, M);
    expect(s.planned).toMatchObject({ minutes: 50, seconds_left: 0, time_up: true });
    let st = await call('GET', '/status', undefined, M);
    const up = st.notifications.find((n: any) => n.title === 'Time is up');
    expect(up.body).toContain('Planned');
    expect(st.session.planned.time_up).toBe(true);
    // Keep going +10: from now, as the planned end has passed.
    s = await call('POST', '/session/extend', { minutes: 10 }, M);
    expect(s.planned.time_up).toBe(false);
    expect(s.planned.seconds_left).toBeGreaterThan(595);
    expect(s.planned.seconds_left).toBeLessThanOrEqual(600);
    st = await call('GET', '/status', undefined, M);
    expect(st.notifications.map((n: any) => n.title)).not.toContain('Time is up');
    // +25 before the end counts from the planned end.
    s = await call('POST', '/session/extend', { minutes: 25 }, M);
    expect(s.planned.seconds_left).toBeGreaterThan(34 * 60);
    s = await call('POST', '/session/extend', { minutes: null }, M);
    expect(s.planned).toBeNull();
    await call('POST', '/session/extend', { minutes: 0 }, { ...M, expect: 400 });
    await call('POST', '/session/stop', {}, M);
  });

  it('validates and remembers the planned length, including no limit', async () => {
    const p = await call('POST', '/projects', { name: 'Lengths' }, M);
    await call('POST', '/session/start', { project_id: p.id, planned_min: 601 }, { ...M, expect: 400 });
    await call('POST', '/session/start', { project_id: p.id, planned_min: 1.5 }, { ...M, expect: 400 });
    let s = await call('POST', '/session/start', { project_id: p.id, planned_min: 600 }, M);
    expect(s.planned.minutes).toBe(600);
    await call('POST', '/session/stop', { discard: true }, M);
    s = await call('POST', '/session/start', { project_id: p.id, planned_min: null }, M);
    expect(s.planned).toBeNull();
    await call('POST', '/session/stop', { discard: true }, M);
    // Without planned_min (Claude, the menu bar) the length used last applies: no limit.
    s = await call('POST', '/session/start', { project_id: p.id }, M);
    expect(s.planned).toBeNull();
    expect((await call('GET', '/session/state', undefined, M)).defaults.planned_min).toBeNull();
    await call('POST', '/session/stop', { discard: true }, M);
  });

  it('Claude can pause and resume', async () => {
    const p = await call('POST', '/projects', { name: 'By Claude' }, M);
    await tool('start_session', { project_id: p.id, planned_min: 25, mode: 'work' });
    expect((await tool('pause_session', { mode: 'work' })).paused).toBe(true);
    expect((await tool('resume_session', { mode: 'work' })).paused).toBe(false);
    await tool('stop_session', { discard: true, mode: 'work' });
  });
});

describe('swap focus', () => {
  it('ranks candidates by the rotation, then least recently touched, without locked ones', async () => {
    const cat = await call('POST', '/categories', { label: 'Swap cat' }, M);
    const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'long' }).format(new Date()).toLowerCase();
    await call('PUT', '/rotation', { this_week: { [weekday]: cat.id } }, M);
    const old = await call('POST', '/projects', { name: 'Old other', last_touched: '2000-01-01' }, M);
    const inCat = await call('POST', '/projects', { name: 'In rotation', category_id: cat.id, last_touched: '2020-01-01' }, M);
    const locked = await call('POST', '/projects', { name: 'Locked', locked_until: '2999-01-01', last_touched: '1999-01-01' }, M);
    const r = await call('GET', '/focus/candidates', undefined, M);
    const ids = r.projects.map((p: any) => p.id);
    expect(r.category).toBe(cat.id);
    expect(ids[0]).toBe(inCat.id);
    expect(r.projects[0].in_rotation).toBe(true);
    expect(ids.indexOf(old.id)).toBeGreaterThan(0);
    expect(ids).not.toContain(locked.id);
    await call('PUT', '/rotation', { this_week: { [weekday]: null } }, M);
  });

  it('sets the reminder the owner chose, or none', async () => {
    const a = await call('POST', '/projects', { name: 'Swap A' }, M);
    const b = await call('POST', '/projects', { name: 'Swap B' }, M);
    const c = await call('POST', '/projects', { name: 'Swap C' }, M);
    await call('PUT', '/focus', { project_id: a.id }, M);
    const t = await call('PUT', '/focus', { project_id: b.id, remind_in_days: 7 }, M);
    const [ra] = await call('GET', `/reminders?project_id=${a.id}`, undefined, M);
    const days = Math.round((Date.parse(ra.due) - Date.parse(`${t.day}T08:00:00.000Z`)) / 86_400_000);
    expect(days).toBe(7);
    await call('PUT', '/focus', { project_id: c.id, remind_in_days: null }, M);
    expect(await call('GET', `/reminders?project_id=${b.id}`, undefined, M)).toHaveLength(0);
    expect(await call('GET', `/skips?project_id=${b.id}`, undefined, M)).toHaveLength(1);
    await call('PUT', '/focus', { project_id: a.id, remind_in_days: 0 }, { ...M, expect: 400 });
    await tool('set_focus', { project_id: a.id, remind_in_days: 3, mode: 'work' });
    const [rc] = await call('GET', `/reminders?project_id=${c.id}`, undefined, M);
    expect(Math.round((Date.parse(rc.due) - Date.parse(`${t.day}T08:00:00.000Z`)) / 86_400_000)).toBe(3);
    await call('PUT', '/focus', { project_id: null }, M);
  });
});
