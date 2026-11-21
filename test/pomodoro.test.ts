// The Pomodoro on its own: breaks, a long break every few rounds, waiting for a click, pause,
// and a break pausing the session timer when that setting is on.
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { apiToken, BASE, call } from './helpers';

const M = { mode: 'work' };
const MIN = 60_000;

async function stored() {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE mode = 'work' AND key = 'pomodoro.current'").first<{ value: string }>();
  return JSON.parse(r!.value);
}
/** Pretend ms have passed: the period started that long ago. */
async function pass(ms: number) {
  const s = await stored();
  const back = (t: string) => new Date(Date.parse(t) - ms).toISOString();
  await env.DB.prepare("UPDATE settings SET value = ? WHERE mode = 'work' AND key = 'pomodoro.current'").bind(JSON.stringify({ ...s, started_at: back(s.started_at), paused_at: s.paused_at ? back(s.paused_at) : s.paused_at })).run();
}
const setting = (key: string, value: string | null) => call('PUT', `/settings/${key}`, { value, global: false }, M);
const view = async () => (await call('GET', '/pomodoro', undefined, M)).pomodoro;

beforeEach(async () => {
  await call('POST', '/pomodoro/stop', {}, M);
  if (await call('GET', '/session', undefined, M)) await call('POST', '/session/stop', { discard: true }, M);
  for (const k of ['pomodoro.work', 'pomodoro.break', 'pomodoro.long_break', 'pomodoro.rounds', 'pomodoro.breaks_pause_session']) await setting(k, null);
});

describe('pomodoro', () => {
  it('starts a 25 minute work period and waits for a click when it ends', async () => {
    const r = await call('POST', '/pomodoro/start', {}, M);
    expect(r.pomodoro).toMatchObject({ phase: 'work', round: 1, rounds: 4, seconds_total: 1500, waiting: false });
    await pass(25 * MIN);
    expect(await view()).toMatchObject({ phase: 'work', seconds_left: 0, waiting: true, next_phase: 'break' });
  });

  it('goes work, break, work, … and a long break after the 4th work period', async () => {
    await call('POST', '/pomodoro/start', {}, M);
    const phases: string[] = [];
    for (let i = 0; i < 8; i++) {
      await call('POST', '/pomodoro/next', {}, M);
      phases.push((await view()).phase + (await view()).round);
    }
    expect(phases).toEqual(['break1', 'work2', 'break2', 'work3', 'break3', 'work4', 'long_break4', 'work1']);
  });

  it('uses the break lengths from settings', async () => {
    await setting('pomodoro.work', '30');
    await setting('pomodoro.break', '7');
    await setting('pomodoro.long_break', '20');
    await setting('pomodoro.rounds', '2');
    expect((await call('POST', '/pomodoro/start', {}, M)).pomodoro.seconds_total).toBe(1800);
    expect((await call('POST', '/pomodoro/next', {}, M)).pomodoro).toMatchObject({ phase: 'break', seconds_total: 420 });
    await call('POST', '/pomodoro/next', {}, M);
    expect((await call('POST', '/pomodoro/next', {}, M)).pomodoro).toMatchObject({ phase: 'long_break', seconds_total: 1200 });
  });

  it('a pause stops the clock', async () => {
    await call('POST', '/pomodoro/start', {}, M);
    await pass(10 * MIN);
    await call('POST', '/pomodoro/pause', {}, M);
    await pass(60 * MIN);
    const paused = await view();
    expect(paused.paused).toBe(true);
    expect(paused.seconds_left).toBe(900);
    await call('POST', '/pomodoro/resume', {}, M);
    expect((await view()).seconds_left).toBeGreaterThan(890);
  });

  it('a running pomodoro is not part of the session', async () => {
    const p = await call('POST', '/projects', { name: 'Pomodoro apart' }, M);
    await call('PUT', '/focus', { project_id: p.id }, M);
    const s = await call('POST', '/session/start', {}, M);
    expect(s.pomodoro).toBeNull();
    await call('POST', '/pomodoro/start', {}, M);
    await call('POST', '/session/stop', { discard: true }, M);
    expect(await view()).toMatchObject({ phase: 'work' });
  });

  it('a break pauses the session when the setting is on, and work resumes it', async () => {
    await setting('pomodoro.breaks_pause_session', 'on');
    const p = await call('POST', '/projects', { name: 'Break pause' }, M);
    await call('PUT', '/focus', { project_id: p.id }, M);
    await call('POST', '/session/start', {}, M);
    await call('POST', '/pomodoro/start', {}, M);
    await call('POST', '/pomodoro/next', {}, M); // the break
    expect((await call('GET', '/session', undefined, M)).paused).toBe(true);
    await call('POST', '/pomodoro/next', {}, M); // back to work
    expect((await call('GET', '/session', undefined, M)).paused).toBe(false);
  });

  it('a break leaves a session alone when the setting is off', async () => {
    const p = await call('POST', '/projects', { name: 'No break pause' }, M);
    await call('PUT', '/focus', { project_id: p.id }, M);
    await call('POST', '/session/start', {}, M);
    await call('POST', '/pomodoro/start', {}, M);
    await call('POST', '/pomodoro/next', {}, M);
    expect((await call('GET', '/session', undefined, M)).paused).toBe(false);
  });

  it('the menu bar shows the countdown unless it is switched off', async () => {
    await call('POST', '/pomodoro/start', {}, M);
    expect(await menuBar()).toContain('@@P:');
    await setting('swiftbar.show_pomodoro', 'off');
    expect(await menuBar()).not.toContain('@@P:');
  });
});

async function menuBar(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/swiftbar`, { headers: { Authorization: `Bearer ${await apiToken()}`, 'X-Mode': 'work' } });
  return res.text();
}
