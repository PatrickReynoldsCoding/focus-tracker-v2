import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { Ctx } from '../src/core/ctx';
import { dailyNudge, pendingNotifications } from '../src/modules/notifications';
import { inWindow } from '../src/modules/notify-prefs';
import { BASE, apiToken, call, tool, toolError } from './helpers';

const m = { mode: 'work' };
const OLD = '2000-01-01T09:00:00Z';

async function reset() {
  for (const t of ['notifications', 'reminders', 'habits', 'projects']) await env.DB.exec(`DELETE FROM ${t}`);
  await env.DB.exec("DELETE FROM settings WHERE key IN ('notify', 'timezone', 'session.current') OR key LIKE 'nudge.%'");
}
const ctxAt = (iso: string) => new Ctx(env as any, 'work', new Date(iso));
const titles = (list: any[]) => list.map((n) => n.title).sort();
async function swiftbar(client?: string) {
  const res = await SELF.fetch(`${BASE}/api/swiftbar${client ? `?client=${client}` : ''}`, { headers: { Authorization: `Bearer ${await apiToken()}`, 'X-Mode': 'work' } });
  return res.text();
}

beforeEach(reset);

describe('notification settings', () => {
  it('has sensible defaults and validates changes', async () => {
    const s = await call('GET', '/notification-settings', undefined, m);
    expect(s).toMatchObject({ enabled: true, reminders: true, habits: true, nudge: true, session: true, nudge_hour: 9, nudge_days: 14 });
    expect(s.quiet).toEqual({ enabled: false, from: '22:00', to: '07:00' });
    expect(s.clients).toEqual({ android: true, swiftbar: true, web: true });
    await call('PUT', '/notification-settings', { quiet: { enabled: true, from: '25:00' } }, { ...m, expect: 400 });
    await call('PUT', '/notification-settings', { quiet: { enabled: true, from: '08:00', to: '08:00' } }, { ...m, expect: 400 });
    await call('PUT', '/notification-settings', { nudge_hour: 24 }, { ...m, expect: 400 });
    const t = await call('PUT', '/notification-settings', { reminders: false, quiet: { enabled: true, to: '06:30' }, nudge_hour: 8, nudge_days: 7 }, m);
    expect(t).toMatchObject({ reminders: false, enabled: true, nudge_hour: 8, nudge_days: 7 });
    expect(t.quiet).toEqual({ enabled: true, from: '22:00', to: '06:30' });
    // The nudge controls are the old settings, so the rest of the app keeps reading them.
    expect((await call('GET', '/settings', undefined, m)).mode['nudge.days']).toBe('7');
    // Notification switches are the same in every mode.
    expect((await call('GET', '/notification-settings', undefined, { mode: 'personal' })).reminders).toBe(false);
  });

  it('the master switch hides every kind from status, pending and the menu bar', async () => {
    await call('POST', '/reminders', { text: 'Call Bob', due: OLD }, m);
    expect((await call('GET', '/status', undefined, m)).notifications).toHaveLength(1);
    await call('PUT', '/notification-settings', { enabled: false }, m);
    expect((await call('GET', '/status', undefined, m)).notifications).toEqual([]);
    expect(await call('GET', '/notifications/pending', undefined, m)).toEqual([]);
    expect(await swiftbar()).not.toContain('#notify');
    expect(await swiftbar()).not.toContain('Call Bob');
    // Switched back on, the reminder that is still not done shows.
    await call('PUT', '/notification-settings', { enabled: true }, m);
    expect((await call('GET', '/notifications/pending', undefined, m)).map((n: any) => n.body)).toEqual(['Call Bob']);
  });

  it('each kind has its own switch', async () => {
    await call('POST', '/reminders', { text: 'Call Bob', due: OLD }, m);
    await call('POST', '/habits', { name: 'Walk', sessions: 1, per: 'day', next_prompt: OLD }, m);
    expect(titles(await call('GET', '/notifications/pending', undefined, m))).toEqual(['Reminder', 'Walk']);
    await call('PUT', '/notification-settings', { reminders: false }, m);
    expect(titles(await call('GET', '/notifications/pending', undefined, m))).toEqual(['Walk']);
    await call('PUT', '/notification-settings', { reminders: true, habits: false }, m);
    // A notification made earlier is hidden too when its kind is switched off.
    expect(titles(await call('GET', '/notifications/pending', undefined, m))).toEqual(['Reminder']);
    await call('PUT', '/notification-settings', { habits: true }, m);
    expect(titles(await call('GET', '/notifications/pending', undefined, m))).toEqual(['Reminder', 'Walk']);
  });

  it('session alerts can be switched off', async () => {
    const p = await call('POST', '/projects', { name: 'Pomo' }, m);
    const started = new Date(Date.now() - 26 * 60000).toISOString();
    await env.DB.prepare("INSERT INTO settings (mode, key, value, updated_at) VALUES ('work', 'session.current', ?, ?)")
      .bind(JSON.stringify({ project_id: p.id, started, pomodoro: { work: 25, break: 5 } }), started)
      .run();
    await call('PUT', '/notification-settings', { session: false }, m);
    expect(await swiftbar()).not.toContain('#notify');
    expect(await call('GET', '/notifications/pending', undefined, m)).toEqual([]);
    await call('PUT', '/notification-settings', { session: true }, m);
    expect(await swiftbar()).toMatch(/#notify\t\w+\tBreak time/);
  });

  it('the daily nudge can be switched off, and moved with its hour', async () => {
    await call('POST', '/projects', { name: 'Garden shed', last_touched: '2000-01-01' }, m);
    await call('PUT', '/notification-settings', { nudge: false }, m);
    await dailyNudge(ctxAt('2026-11-18T10:00:00Z'));
    expect(await pendingNotifications(ctxAt('2026-11-18T10:00:00Z'))).toEqual([]);
    await call('PUT', '/notification-settings', { nudge: true, nudge_hour: 11 }, m);
    await dailyNudge(ctxAt('2026-11-18T10:00:00Z')); // London is UTC in November: 10:00, before the hour
    expect(await pendingNotifications(ctxAt('2026-11-18T10:00:00Z'))).toEqual([]);
    await dailyNudge(ctxAt('2026-11-18T11:05:00Z'));
    const n = await pendingNotifications(ctxAt('2026-11-18T11:05:00Z'));
    expect(n.map((x: any) => x.kind)).toEqual(['nudge']);
    // The master switch stops it too.
    await env.DB.exec('DELETE FROM notifications');
    await call('PUT', '/notification-settings', { enabled: false }, m);
    await dailyNudge(ctxAt('2026-11-18T11:05:00Z'));
    await call('PUT', '/notification-settings', { enabled: true }, m);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM notifications').first('n')).toBe(0);
  });

  it('an older nudge.enabled = off still switches the nudge off', async () => {
    await call('POST', '/projects', { name: 'Garden shed', last_touched: '2000-01-01' }, m);
    await call('PUT', '/settings/nudge.enabled', { value: 'off' }, m);
    expect((await call('GET', '/notification-settings', undefined, m)).nudge).toBe(false);
    await dailyNudge(ctxAt('2026-11-18T12:00:00Z'));
    expect(await pendingNotifications(ctxAt('2026-11-18T12:00:00Z'))).toEqual([]);
    await call('PUT', '/notification-settings', { nudge: true }, m); // the new switch replaces it
    expect((await call('GET', '/notification-settings', undefined, m)).nudge).toBe(true);
  });

  it('shows notifications only on the clients that are switched on', async () => {
    await call('POST', '/reminders', { text: 'Call Bob', due: OLD }, m);
    await call('PUT', '/notification-settings', { clients: { swiftbar: false } }, m);
    expect(await call('GET', '/status?client=swiftbar', undefined, m).then((s) => s.notifications)).toEqual([]);
    expect(await swiftbar()).not.toContain('#notify'); // /api/swiftbar counts as swiftbar without ?client=
    expect(await call('GET', '/status?client=android', undefined, m).then((s) => s.notifications)).toHaveLength(1);
    expect(await call('GET', '/today-panels/banners?client=web', undefined, m)).toHaveLength(1);
    expect(await call('GET', '/status', undefined, m).then((s) => s.notifications)).toHaveLength(1); // no client: not filtered
    await call('PUT', '/notification-settings', { clients: { swiftbar: true, web: false } }, m);
    expect(await call('GET', '/today-panels/banners?client=web', undefined, m)).toEqual([]);
    expect(await swiftbar()).toContain('#notify');
  });
});

describe('quiet hours', () => {
  it('inWindow handles windows inside a day and across midnight', () => {
    const min = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
    expect(inWindow(min('13:00'), '12:00', '14:00')).toBe(true);
    expect(inWindow(min('14:00'), '12:00', '14:00')).toBe(false); // the end time is outside
    expect(inWindow(min('12:00'), '12:00', '14:00')).toBe(true);
    expect(inWindow(min('23:30'), '22:00', '07:00')).toBe(true);
    expect(inWindow(min('00:00'), '22:00', '07:00')).toBe(true);
    expect(inWindow(min('06:59'), '22:00', '07:00')).toBe(true);
    expect(inWindow(min('07:00'), '22:00', '07:00')).toBe(false);
    expect(inWindow(min('12:00'), '22:00', '07:00')).toBe(false);
    expect(inWindow(min('12:00'), '09:00', '09:00')).toBe(false);
  });

  it('holds notifications back during quiet hours that cross midnight, then delivers them', async () => {
    await call('POST', '/reminders', { text: 'Call Bob', due: OLD }, m);
    await call('PUT', '/notification-settings', { quiet: { enabled: true, from: '22:00', to: '07:00' } }, m);
    // London in November is UTC.
    for (const t of ['2026-11-18T22:00:00Z', '2026-11-18T23:59:00Z', '2026-11-19T00:30:00Z', '2026-11-19T06:59:00Z']) {
      expect(await pendingNotifications(ctxAt(t)), t).toEqual([]);
    }
    for (const t of ['2026-11-19T07:00:00Z', '2026-11-19T12:00:00Z', '2026-11-18T21:59:00Z']) {
      expect((await pendingNotifications(ctxAt(t))).map((n: any) => n.body), t).toEqual(['Call Bob']);
    }
  });

  it('uses the owner’s time zone', async () => {
    await call('POST', '/reminders', { text: 'Call Bob', due: OLD }, m);
    await call('PUT', '/settings/timezone', { value: 'America/New_York', global: true }, m);
    await call('PUT', '/notification-settings', { quiet: { enabled: true, from: '22:00', to: '07:00' } }, m);
    // 03:30 UTC on the 19th is 22:30 on the 18th in New York (UTC-5): quiet. 12:30 UTC is 07:30: not quiet.
    expect(await pendingNotifications(ctxAt('2026-11-19T03:30:00Z'))).toEqual([]);
    expect(await pendingNotifications(ctxAt('2026-11-19T12:30:00Z'))).toHaveLength(1);
    // 23:00 UTC is 18:00 in New York: not quiet, though it would be in London.
    expect(await pendingNotifications(ctxAt('2026-11-18T23:00:00Z'))).toHaveLength(1);
    expect((await call('GET', '/notification-settings', undefined, m)).timezone).toBe('America/New_York');
  });

  it('keeps what is made during quiet hours until they end, and quiet hours can be switched off', async () => {
    await call('PUT', '/notification-settings', { quiet: { enabled: true, from: '22:00', to: '07:00' } }, m);
    await call('POST', '/habits', { name: 'Walk', sessions: 1, per: 'day', next_prompt: '2026-11-18T23:00:00Z' }, m);
    expect(await pendingNotifications(ctxAt('2026-11-18T23:30:00Z'))).toEqual([]); // made, held back
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM notifications').first('n')).toBe(1);
    expect(titles(await pendingNotifications(ctxAt('2026-11-19T07:01:00Z')))).toEqual(['Walk']);
    await call('PUT', '/notification-settings', { quiet: { enabled: false } }, m);
    expect(titles(await pendingNotifications(ctxAt('2026-11-18T23:30:00Z')))).toEqual(['Walk']);
  });
});

describe('Claude tools', () => {
  it('reads and changes the settings', async () => {
    expect((await tool('get_notification_settings')).enabled).toBe(true);
    const s = await tool('set_notification_settings', { enabled: false, quiet: { enabled: true, from: '23:00', to: '06:00' }, clients: { web: false } });
    expect(s).toMatchObject({ enabled: false, quiet: { enabled: true, from: '23:00', to: '06:00' }, clients: { android: true, swiftbar: true, web: false } });
    expect(await toolError('set_notification_settings', { quiet: { from: 'late' } })).toMatch(/Use a time/);
    expect((await call('GET', '/notification-settings')).enabled).toBe(false);
  });
});
