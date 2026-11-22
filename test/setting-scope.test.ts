// Settings for this profile or for every profile (D46): the value for all profiles, a profile's own
// value over it, "All profiles" clearing the profiles' own values, "Use the global value", the
// overview, new profiles, Claude's tools and migration 0024.
import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS, statements } from '../src/core/migrate';
import { allScoped } from '../src/core/setting-scope';
import { call, tool, toolError } from './helpers';

let n = 0;
const fresh = async (extra: Record<string, unknown> = {}) => (await call('POST', '/profiles', { label: `Scope ${++n} ${Math.random().toString(36).slice(2, 6)}`, ...extra }, { expect: 201 })).profile.id as string;
const row = async (mode: string, key: string) => (await env.DB.prepare('SELECT value FROM settings WHERE mode = ? AND key = ?').bind(mode, key).first<{ value: string }>())?.value ?? null;
const flag = async (id: string, mode: string) => (await call('GET', '/features', undefined, { mode })).find((f: any) => f.id === id).enabled as boolean;
const state = async (id: string, mode: string) => (await call('GET', '/setting-scope', undefined, { mode })).find((s: any) => s.id === id);

afterEach(async () => {
  // Every test starts with no values for all profiles.
  await env.DB.prepare("DELETE FROM settings WHERE mode = '' AND key NOT IN ('timezone', 'default_mode', 'profiles.follow_open')").run();
});

describe('feature switches', () => {
  it('scope all sets every profile and clears their own values; scope profile changes one', async () => {
    const a = await fresh();
    const b = await fresh();
    await call('PUT', '/features/tags', { enabled: false }, { mode: a });
    expect(await flag('tags', a)).toBe(false);
    expect(await flag('tags', b)).toBe(true);
    // All profiles: b had nothing of its own, a had; both now use the value for all.
    await call('PUT', '/features/tags', { enabled: false, scope: 'all' }, { mode: b });
    expect(await flag('tags', a)).toBe(false);
    expect(await flag('tags', b)).toBe(false);
    expect(await flag('tags', 'personal')).toBe(false);
    expect(JSON.parse((await row('', 'features'))!)).toEqual({ tags: false });
    expect((await state('features.tags', a)).own).toBe(false);
    // One profile turns it back on for itself: an own value over the global one.
    await call('PUT', '/features/tags', { enabled: true }, { mode: a });
    expect(await flag('tags', a)).toBe(true);
    expect(await flag('tags', b)).toBe(false);
    const s = await state('features.tags', a);
    expect(s).toMatchObject({ own: true, global: true, global_value: false, value: true });
    expect(s.profiles).toEqual([a]);
    // Use the global value.
    await call('DELETE', '/setting-scope/features.tags', undefined, { mode: a });
    expect(await flag('tags', a)).toBe(false);
    // Other switches are untouched by all this.
    expect(await flag('plan-week', a)).toBe(true);
    await call('PUT', '/features/tags', { enabled: true, scope: 'all' }, { mode: a });
  });

  it('a profile’s own switches survive another switch being set for all', async () => {
    const a = await fresh();
    await call('PUT', '/features/plan-week', { enabled: false }, { mode: a });
    await call('PUT', '/features/tags', { enabled: false, scope: 'all' }, { mode: a });
    expect(JSON.parse((await row(a, 'features'))!)).toEqual({ 'plan-week': false });
    expect(await flag('plan-week', a)).toBe(false);
    await call('PUT', '/features/plan-week', { enabled: true }, { mode: a });
  });

  it('a value the profile already uses does not become its own', async () => {
    const a = await fresh();
    await call('PUT', '/features/tags', { enabled: false, scope: 'all' }, { mode: a });
    await call('PUT', '/features/tags', { enabled: false }, { mode: a });
    expect(await row(a, 'features')).toBeNull();
  });

  it('refuses an unknown scope', async () => {
    await call('PUT', '/features/tags', { enabled: false, scope: 'everyone' }, { expect: 400 });
  });
});

describe('notifications, Pomodoro, session length, link types, Today view', () => {
  it('notification parts each go to this profile or every profile, and the answer says who lost their own', async () => {
    const a = await fresh();
    const b = await fresh();
    await call('PUT', '/notification-settings', { reminders: false, quiet: { enabled: true, from: '21:00', to: '06:00' } }, { mode: a });
    const r = await call('PUT', '/notification-settings', { quiet: { enabled: true, from: '23:00', to: '07:00' }, scope: 'all' }, { mode: b });
    expect(r.cleared).toContain(a);
    expect((await call('GET', '/notification-settings', undefined, { mode: a })).quiet).toEqual({ enabled: true, from: '23:00', to: '07:00' });
    expect((await call('GET', '/notification-settings', undefined, { mode: 'personal' })).quiet.from).toBe('23:00');
    // a keeps its own Reminders switch.
    expect((await call('GET', '/notification-settings', undefined, { mode: a })).reminders).toBe(false);
    expect((await call('GET', '/notification-settings', undefined, { mode: b })).reminders).toBe(true);
    await call('PUT', '/notification-settings', { nudge_hour: 8, scope: 'all' }, { mode: a });
    expect((await call('GET', '/notification-settings', undefined, { mode: b })).nudge_hour).toBe(8);
    await call('PUT', '/notification-settings', { quiet: { from: '23:00', to: '23:00' }, scope: 'all' }, { mode: a, expect: 400 });
  });

  it('Pomodoro lengths and the session length through PUT /settings/:key with a scope', async () => {
    const a = await fresh();
    const b = await fresh();
    await call('PUT', '/settings/pomodoro.work', { value: '40' }, { mode: a });
    await call('PUT', '/settings/pomodoro.work', { value: '30', scope: 'all' }, { mode: b });
    expect((await call('GET', '/pomodoro', undefined, { mode: a })).config.work).toBe(30);
    expect(await row(a, 'pomodoro.work')).toBeNull();
    await call('PUT', '/settings/pomodoro.work', { value: '45' }, { mode: a });
    expect((await call('GET', '/pomodoro', undefined, { mode: a })).config.work).toBe(45);
    expect((await call('GET', '/pomodoro', undefined, { mode: b })).config.work).toBe(30);
    // Empty: back to the value for all profiles.
    await call('PUT', '/settings/pomodoro.work', { value: null }, { mode: a });
    expect((await call('GET', '/pomodoro', undefined, { mode: a })).config.work).toBe(30);
    await call('PUT', '/settings/pomodoro.work', { value: 'lots', scope: 'all' }, { expect: 400 });
    await call('PUT', '/settings/session.length', { value: '50', scope: 'all' }, { mode: a });
    expect((await call('GET', '/session/state', undefined, { mode: b })).defaults.planned_min).toBe(50);
    // A setting that is not one of them cannot be set for all, nor these raw with global.
    await call('PUT', '/settings/rotation.monday', { value: 'away', scope: 'all' }, { expect: 400 });
    await call('PUT', '/settings/pomodoro.work', { value: '20', global: true }, { expect: 400 });
  });

  it('link types for every profile, refused while another profile uses a type that would go', async () => {
    const a = await fresh();
    const b = await fresh();
    for (const m of [a, b]) await call('PUT', '/features/custom-link-types', { enabled: true }, { mode: m });
    await call('POST', '/links/types', { outward: 'funds', inward: 'is funded by' }, { mode: a });
    const p1 = await call('POST', '/projects', { name: 'Money' }, { mode: a });
    const p2 = await call('POST', '/projects', { name: 'Thing' }, { mode: a });
    await call('POST', '/links', { from_kind: 'projects', from_id: p1.id, to_kind: 'projects', to_id: p2.id, type: 'funds' }, { mode: a });
    // b's list for everyone would drop "funds", which a uses.
    await call('POST', '/links/types', { outward: 'feeds', scope: 'all' }, { mode: b, expect: 400 });
    // a's list (with funds) for everyone is fine.
    await call('POST', '/links/types', { outward: 'feeds', scope: 'all' }, { mode: a });
    const ids = (await call('GET', '/links/types', undefined, { mode: b })).map((t: any) => t.id);
    expect(ids).toEqual(expect.arrayContaining(['funds', 'feeds']));
  });

  it('Today’s view switches', async () => {
    const a = await fresh();
    const b = await fresh();
    await call('PUT', '/layout/today/view', { focusCard: 'full' }, { mode: a });
    await call('PUT', '/layout/today/view', { pillCounts: false, scope: 'all' }, { mode: b });
    expect((await call('GET', '/layout/today', undefined, { mode: a })).view).toEqual({ focusCard: 'full', pillCounts: false });
    // The web app sends the whole view: fields that are the same as the global value do not become own.
    await call('PUT', '/layout/today/view', { focusCard: 'hidden', pillCounts: false }, { mode: b });
    expect(JSON.parse((await row(b, 'layout.today.view'))!)).toEqual({ focusCard: 'hidden' });
    await call('PUT', '/layout/project/view', { focusCard: 'full', scope: 'all' }, { expect: 400 });
  });
});

describe('overview, apply to all, new profiles', () => {
  it('lists every scoped setting and applies this profile’s value to all', async () => {
    const a = await fresh();
    const b = await fresh();
    await call('PUT', '/settings/pomodoro.rounds', { value: '6' }, { mode: a });
    await call('PUT', '/settings/pomodoro.rounds', { value: '3' }, { mode: b });
    const list = await call('GET', '/setting-scope', undefined, { mode: a });
    expect(list.map((s: any) => s.id)).toEqual(expect.arrayContaining(['features.habits', 'features.insights', 'notify.quiet', 'nudge.hour', 'pomodoro.work', 'session.length', 'links.types', 'today-view.focusCard']));
    const r = await call('POST', '/setting-scope/pomodoro.rounds/all', {}, { mode: a });
    expect(r.cleared.sort()).toEqual([a, b].sort());
    expect((await call('GET', '/pomodoro', undefined, { mode: b })).config.rounds).toBe(6);
    await call('DELETE', '/setting-scope/nothing.here', undefined, { expect: 400 });
  });

  it('a new profile with the usual settings gets the values for all; a copy gets the source’s own values too', async () => {
    const a = await fresh();
    await call('PUT', '/features/tags', { enabled: false, scope: 'all' }, { mode: a });
    await call('PUT', '/features/plan-week', { enabled: false }, { mode: a });
    const plain = await fresh();
    expect(await flag('tags', plain)).toBe(false);
    expect(await flag('plan-week', plain)).toBe(true);
    const copy = await fresh({ copy_from: a });
    expect(await flag('tags', copy)).toBe(false);
    expect(await flag('plan-week', copy)).toBe(false);
  });
});

describe('Claude', () => {
  it('set_feature, set_notification_settings and set_setting take a scope; use_global_setting clears', async () => {
    const a = await fresh();
    await tool('set_feature', { id: 'tags', enabled: false, scope: 'all', mode: a });
    expect(await flag('tags', 'personal')).toBe(false);
    const f = await tool('set_feature', { id: 'tags', enabled: true, mode: a });
    expect(f).toMatchObject({ enabled: true, own: true, for_all: false });
    expect(await flag('tags', 'personal')).toBe(false);
    expect((await tool('get_features', { mode: a })).find((x: any) => x.id === 'tags').enabled).toBe(true);
    await tool('use_global_setting', { id: 'features.tags', mode: a });
    expect(await flag('tags', a)).toBe(false);
    await tool('set_notification_settings', { habits: false, scope: 'all', mode: a });
    expect((await call('GET', '/notification-settings', undefined, { mode: 'personal' })).habits).toBe(false);
    await tool('set_setting', { id: 'pomodoro.break', value: 7, scope: 'all', mode: a });
    expect((await call('GET', '/pomodoro', undefined, { mode: 'personal' })).config.break).toBe(7);
    expect(await toolError('set_setting', { id: 'pomodoro.break', value: 'soon' })).toMatch(/whole number/);
    const states = await tool('get_setting_scopes', { mode: a });
    expect(states.find((s: any) => s.id === 'pomodoro.break')).toMatchObject({ global: true, value: '7' });
    await tool('set_today_pills', { pills: null, view: { pillSwipe: false }, view_scope: 'all', mode: a });
    expect((await call('GET', '/layout/today', undefined, { mode: 'personal' })).view.pillSwipe).toBe(false);
  });

  it('a tool turned off for every profile is gone from the list until a profile turns it on', async () => {
    const a = await fresh();
    const names = async () => (await (await import('./helpers')).mcp<any>('tools/list')).tools.map((t: any) => t.name);
    await call('PUT', '/features/tags', { enabled: false, scope: 'all' }, { mode: a });
    expect(await names()).not.toContain('list_tags');
    await call('PUT', '/features/tags', { enabled: true }, { mode: a });
    expect(await names()).toContain('list_tags');
  });
});

describe('migration 0024', () => {
  it('removes leftover rows for all profiles of these settings and lists every scoped key', async () => {
    const sql = MIGRATIONS.find(([name]) => name === '0024_setting_scope.sql')![1];
    for (const u of allScoped()) expect(sql, `${u.key} is in the migration`).toContain(`'${u.key}'`);
    await env.DB.prepare("INSERT INTO settings (mode, key, value, updated_at) VALUES ('', 'pomodoro.work', '99', 'x'), ('personal', 'pomodoro.work', '20', 'x'), ('', 'timezone', 'Europe/London', 'x') ON CONFLICT (mode, key) DO UPDATE SET value = excluded.value").run();
    await env.DB.batch(statements(sql).map((s) => env.DB.prepare(s)));
    expect(await row('', 'pomodoro.work')).toBeNull();
    expect(await row('personal', 'pomodoro.work')).toBe('20');
    expect(await row('', 'timezone')).toBe('Europe/London');
    await env.DB.prepare("DELETE FROM settings WHERE mode = 'personal' AND key = 'pomodoro.work'").run();
  });
});
