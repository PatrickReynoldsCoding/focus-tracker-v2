// Profiles (modes): the menu bar's red number and "Not today", the profile open in the app being the
// default for clients that send none, settings and feature switches per profile, a new profile with
// copied settings, deleting a profile with everything in it (and restoring it), and Claude's tools (D35).
import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS, statements } from '../src/core/migrate';
import { modeTables, purgeExpired } from '../src/modules/profiles';
import { apiToken, BASE, call, mcp, tool, toolError } from './helpers';

const text = async (headers: Record<string, string> = {}) =>
  (await SELF.fetch(`${BASE}/api/swiftbar`, { headers: { Authorization: `Bearer ${await apiToken()}`, ...headers } })).text();

let n = 0;
const fresh = async (extra: Record<string, unknown> = {}) => (await call('POST', '/profiles', { label: `Profile ${++n} ${Math.random().toString(36).slice(2, 6)}`, ...extra }, { expect: 201 })).profile;
const setting = async (mode: string, key: string) =>
  (await env.DB.prepare('SELECT value FROM settings WHERE mode = ? AND key = ?').bind(mode, key).first<{ value: string }>())?.value ?? null;
const flagOf = async (id: string, mode: string) => (await call('GET', '/features', undefined, { mode })).find((f: any) => f.id === id).enabled;
const rowsLeft = async (mode: string) => {
  let total = 0;
  for (const t of modeTables()) total += (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE mode = ?`).bind(mode).first<{ n: number }>())!.n;
  return total;
};

describe('menu bar', () => {
  it('shows a red number for what is left today, and Not today takes an item off the list', async () => {
    await call('POST', '/modes', { label: 'Side stuff' }, { mode: 'personal' }).catch(() => {});
    const M = { mode: 'side-stuff' };
    const today = (await call('GET', '/today', undefined, M)).day;
    const a = await call('POST', '/todos', { title: 'Put this off', day: today }, M);
    await call('POST', '/todos', { title: 'Do this', day: today }, M);
    const before = await text({ 'X-Mode': 'side-stuff' });
    expect(before).toMatch(/sfimage=\d+\.circle\.fill sfcolor=red/);
    await SELF.fetch(`${BASE}/api/swiftbar/action`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await apiToken()}`, 'X-Mode': 'side-stuff' },
      body: new URLSearchParams({ action: 'nottoday', id: `todo:${a.id}` }),
    });
    const list = await call('GET', '/today/list', undefined, M);
    expect(list.items.find((x: { id: string }) => x.id === a.id).state).toBe('skipped');
    expect(list.left).toBe(1);
    expect(await text({ 'X-Mode': 'side-stuff' })).toContain('sfimage=1.circle.fill');
  });

  it('follows the default profile when the client sends no mode', async () => {
    await call('PUT', '/settings/default_mode', { value: 'side-stuff', global: true });
    expect(await text()).toContain('Profile: side-stuff');
    await call('PUT', '/settings/default_mode', { value: 'personal', global: true });
    expect(await text()).toContain('Profile: personal');
  });
});

describe('migration 0021: settings for the whole tracker become per profile', () => {
  it('copies features, notifications, session length and link types into every profile, keeping what a profile has', async () => {
    const run = async () => {
      const sql = MIGRATIONS.find(([name]) => name === '0021_profile_settings.sql')![1];
      // Only the settings part: the table it makes is there already.
      const copy = statements(sql).filter((s) => !s.startsWith('CREATE TABLE'));
      await env.DB.batch(copy.map((s) => env.DB.prepare(s)));
    };
    const put = (mode: string, key: string, value: string) =>
      env.DB.prepare('INSERT OR REPLACE INTO settings (mode, key, value, updated_at) VALUES (?, ?, ?, ?)').bind(mode, key, value, '2026-11-01T00:00:00.000Z').run();
    const p = await fresh();
    await put('', 'features', JSON.stringify({ 'plan-week': false }));
    await put('', 'notify', JSON.stringify({ reminders: false }));
    await put('', 'session.length', '50');
    await put('', 'links.types', JSON.stringify([{ id: 'funds', outward: 'funds', inward: 'is funded by' }]));
    await put('', 'timezone', 'Europe/Paris');
    await put(p.id, 'session.length', '90'); // already set in a profile: kept
    await run();
    for (const mode of ['personal', 'work', p.id]) {
      expect(JSON.parse((await setting(mode, 'features'))!)).toEqual({ 'plan-week': false });
      expect(JSON.parse((await setting(mode, 'notify'))!)).toEqual({ reminders: false });
      expect(await setting(mode, 'links.types')).toContain('funds');
    }
    expect(await setting('work', 'session.length')).toBe('50');
    expect(await setting(p.id, 'session.length')).toBe('90');
    for (const key of ['features', 'notify', 'session.length', 'links.types']) expect(await setting('', key)).toBeNull();
    expect(await setting('', 'timezone')).toBe('Europe/Paris'); // still global
    // The app reads them per profile now.
    expect(await flagOf('plan-week', 'work')).toBe(false);
    expect((await call('GET', '/notification-settings', undefined, { mode: 'work' })).reminders).toBe(false);
    // Running it again changes nothing.
    await run();
    expect(await setting(p.id, 'session.length')).toBe('90');
    await env.DB.exec("DELETE FROM settings WHERE key IN ('features', 'notify', 'session.length', 'links.types', 'timezone')");
  });
});

describe('feature switches per profile', () => {
  it('each profile switches its own; routes and Claude follow the profile asked about', async () => {
    const a = await fresh();
    const b = await fresh();
    await call('PUT', '/features/plan-week', { enabled: false }, { mode: a.id });
    expect(await flagOf('plan-week', a.id)).toBe(false);
    expect(await flagOf('plan-week', b.id)).toBe(true);
    await call('GET', '/plan', undefined, { mode: a.id, expect: 404 });
    await call('GET', '/plan', undefined, { mode: b.id });
    // Claude: the tool is listed while it is on in some profile, and refused in a profile where it is off.
    const names = (await mcp<any>('tools/list')).tools.map((t: any) => t.name);
    expect(names).toContain('get_week_plan');
    expect(await toolError('get_week_plan', { mode: a.id })).toMatch(/turned off in the profile/);
    await tool('get_week_plan', { mode: b.id });
  });

  it('a tool off in every profile is not listed', async () => {
    const modes = await call('GET', '/modes');
    for (const m of modes) await call('PUT', '/features/plan-week', { enabled: false }, { mode: m.id });
    try {
      expect((await mcp<any>('tools/list')).tools.map((t: any) => t.name)).not.toContain('get_week_plan');
    } finally {
      for (const m of modes) await call('PUT', '/features/plan-week', { enabled: true }, { mode: m.id });
    }
  });

  it('notification settings, the session length and link types are per profile; the time zone stays global', async () => {
    const a = await fresh();
    const b = await fresh();
    await call('PUT', '/notification-settings', { reminders: false, quiet: { enabled: true } }, { mode: a.id });
    expect((await call('GET', '/notification-settings', undefined, { mode: b.id })).reminders).toBe(true);
    await call('PUT', '/features/custom-link-types', { enabled: true }, { mode: a.id });
    await call('POST', '/links/types', { outward: 'feeds', inward: 'is fed by' }, { mode: a.id });
    expect((await call('GET', '/links/types', undefined, { mode: a.id })).some((t: any) => t.id === 'feeds')).toBe(true);
    await call('PUT', '/features/custom-link-types', { enabled: true }, { mode: b.id });
    expect((await call('GET', '/links/types', undefined, { mode: b.id })).some((t: any) => t.id === 'feeds')).toBe(false);
    const proj = await call('POST', '/projects', { name: 'Timed' }, { mode: a.id });
    await call('POST', '/session/start', { project_id: proj.id, planned_min: 50 }, { mode: a.id });
    await call('POST', '/session/stop', {}, { mode: a.id });
    expect(await setting(a.id, 'session.length')).toBe('50');
    expect(await setting(b.id, 'session.length')).toBeNull();
    await call('PUT', '/settings/timezone', { value: 'Europe/Paris', global: true }, { mode: a.id });
    expect((await call('GET', '/settings', undefined, { mode: b.id })).global.timezone).toBe('Europe/Paris');
    await call('PUT', '/settings/timezone', { value: 'Europe/London', global: true });
    // A per-profile setting cannot be written for every profile by mistake.
    await call('PUT', '/settings/notify', { value: '{}', global: true }, { expect: 400 });
  });
});

describe('a new profile', () => {
  it('starts with the usual settings', async () => {
    const p = await fresh({ color: '#3366cc' });
    expect(p.color).toBe('#3366cc');
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM settings WHERE mode = ?').bind(p.id).first<{ n: number }>())!.n).toBe(0);
    expect((await call('GET', '/features', undefined, { mode: p.id })).every((f: any) => f.enabled === f.default)).toBe(true);
    expect((await call('GET', '/profiles')).profiles.map((x: any) => x.id)).toContain(p.id);
  });

  it('can copy another profile’s settings, but not its data or its state', async () => {
    const src = await fresh();
    const m = { mode: src.id };
    await call('PUT', '/features/plan-week', { enabled: false }, m);
    await call('PUT', '/notification-settings', { habits: false, nudge_hour: 7 }, m);
    await call('PUT', '/settings/pomodoro.work', { value: '40' }, m);
    await call('PUT', '/settings/swiftbar.show_pomodoro', { value: 'off' }, m);
    const list = await call('POST', '/lists', { name: 'Shopping', kind: 'list', show_today: true }, m);
    await call('PUT', '/layout/today/pills', { pills: [{ id: 'p1', name: 'Mine', icon: '🏠', panels: ['today-list', `list-${list.id}`] }] }, m);
    await call('PUT', '/layout/today/grid', { items: { 'today-list': { x: 0, y: 0, w: 6 }, [`list-${list.id}`]: { x: 6, y: 0, w: 6 } }, removed: [`list-${list.id}`, 'week'] }, m);
    await call('PUT', '/layout/today/view', { focusCard: 'full' }, m);
    await call('POST', '/projects', { name: 'Secret project' }, m);
    await call('PUT', '/rotation', { usual: { monday: 'away' } }, m);
    await call('POST', '/pomodoro/start', {}, m);
    const made = await call('POST', '/profiles', { label: 'Copy of it', copy_from: src.id }, { expect: 201 });
    const c = { mode: made.profile.id };
    expect(made.settings_copied).toBeGreaterThan(3);
    expect(await flagOf('plan-week', made.profile.id)).toBe(false);
    expect(await call('GET', '/notification-settings', undefined, c)).toMatchObject({ habits: false, nudge_hour: 7 });
    const s = (await call('GET', '/settings', undefined, c)).mode;
    expect(s['pomodoro.work']).toBe('40');
    expect(s['swiftbar.show_pomodoro']).toBe('off');
    const lay = await call('GET', '/layout/today', undefined, c);
    expect(lay.pills).toEqual([{ id: 'p1', name: 'Mine', icon: '🏠', panels: ['today-list'] }]); // the list is the other profile's
    expect(Object.keys(lay.grid.items)).toEqual(['today-list']);
    expect(lay.grid.removed).toEqual(['week']);
    expect(lay.view).toMatchObject({ focusCard: 'full' });
    // Data and state stay behind.
    expect(await call('GET', '/projects', undefined, c)).toEqual([]);
    expect(await call('GET', '/lists', undefined, c)).toEqual([]);
    expect((await call('GET', '/rotation', undefined, c)).usual.monday).not.toBe('away');
    expect(await setting(made.profile.id, 'pomodoro.current')).toBeNull();
    // The source is unchanged.
    expect(await flagOf('plan-week', src.id)).toBe(false);
  });

  it('checks its name, colour and the profile to copy from', async () => {
    await call('POST', '/profiles', { label: '  ' }, { expect: 400 });
    await call('POST', '/profiles', { label: 'Work' }, { expect: 400 }); // there is one already
    await call('POST', '/profiles', { label: 'work ' }, { expect: 400 });
    await call('POST', '/profiles', { label: 'Odd', color: 'blue' }, { expect: 400 });
    await call('POST', '/profiles', { label: 'Odd', copy_from: 'nope' }, { expect: 400 });
    await call('POST', '/profiles', { label: 'x'.repeat(41) }, { expect: 400 });
  });
});

describe('managing profiles', () => {
  it('renames, recolours, reorders and sets the default', async () => {
    const p = await fresh();
    const up = await call('PATCH', `/profiles/${p.id}`, { label: 'Renamed one', color: '#112233', position: 1 });
    expect(up).toMatchObject({ id: p.id, label: 'Renamed one', color: '#112233' });
    let all = await call('GET', '/profiles');
    expect(all.profiles[0]).toMatchObject({ id: p.id, label: 'Renamed one', color: '#112233' });
    expect(all.default).toBe('personal');
    await call('PATCH', `/profiles/${p.id}`, { label: 'Work' }, { expect: 400 }); // taken
    await call('PATCH', `/profiles/${p.id}`, { color: '' });
    expect((await call('GET', '/profiles')).profiles[0].color).toBeNull();
    all = await call('PUT', '/profiles/default', { id: p.id });
    expect(all.default).toBe(p.id);
    // A request that names no profile uses the default one.
    await call('POST', '/projects', { name: 'Went to the default' });
    expect((await call('GET', '/projects', undefined, { mode: p.id })).map((x: any) => x.name)).toContain('Went to the default');
    await call('PUT', '/profiles/default', { id: 'nope' }, { expect: 404 });
    await call('PUT', '/settings/default_mode', { value: 'nope', global: true }, { expect: 400 });
    await call('PUT', '/settings/default_mode', { value: 'work' }, { expect: 400 }); // global only
    await call('PUT', '/profiles/default', { id: 'personal' });
    await call('PATCH', `/profiles/${p.id}`, { position: 99 });
    expect((await call('GET', '/profiles')).profiles.at(-1).id).toBe(p.id);
  });

  it('opening a profile leaves the default alone unless that is turned on (D54)', async () => {
    const p = await fresh();
    await call('PUT', '/profiles/default', { id: 'personal' });
    // Off by default: the default is only what is chosen with Make default.
    expect((await call('GET', '/profiles')).follow_open).toBe(false);
    expect(await call('POST', '/profiles/opened', { id: p.id })).toEqual({ default: 'personal', follow_open: false });
    // An 'off' row from before (v0.25 to v0.42 stored only that) still means off.
    await env.DB.prepare("INSERT OR REPLACE INTO settings (mode, key, value, updated_at) VALUES ('', 'profiles.follow_open', 'off', ?)").bind(new Date().toISOString()).run();
    expect((await call('GET', '/profiles')).follow_open).toBe(false);
    // Turned on, the profile opened becomes the default.
    const on = await call('PUT', '/profiles/follow-open', { on: true });
    expect(on.follow_open).toBe(true);
    expect(await call('POST', '/profiles/opened', { id: p.id })).toEqual({ default: p.id, follow_open: true });
    expect(await text()).toContain(`Profile: ${p.id}`);
    await call('PUT', '/profiles/default', { id: 'personal' });
    await call('PUT', '/profiles/follow-open', { on: false });
    expect(await call('POST', '/profiles/opened', { id: p.id })).toEqual({ default: 'personal', follow_open: false });
    await call('POST', '/profiles/opened', { id: 'nope' }, { expect: 404 });
  });

  it('deletes a profile and everything in it only with its name, can restore it, and moves the default', async () => {
    const p = await fresh();
    const m = { mode: p.id };
    const proj = await call('POST', '/projects', { name: 'Gone soon' }, m);
    await call('POST', '/tasks', { project_id: proj.id, title: 'A card' }, m);
    await call('POST', '/habits', { name: 'Stretch' }, m);
    await call('PUT', '/features/plan-week', { enabled: false }, m);
    await call('PATCH', `/projects/${proj.id}`, { name: 'Still here' }, m); // leaves undo history
    await call('PUT', '/profiles/default', { id: p.id });
    const usage = await call('GET', `/profiles/${p.id}/usage`);
    expect(usage.find((u: any) => u.kind === 'projects')?.count).toBe(1);
    expect((await call('POST', `/profiles/${p.id}/delete`, {}, { expect: 400 })).code).toBe('confirm_needed');
    await call('POST', `/profiles/${p.id}/delete`, { confirm: 'something else' }, { expect: 400 });
    // The plain delete still refuses a profile with data.
    await call('DELETE', `/modes/${p.id}`, undefined, { expect: 400 });
    const r = await call('POST', `/profiles/${p.id}/delete`, { confirm: ` ${p.label.toUpperCase()} ` });
    expect(r).toMatchObject({ deleted: p.id, default: 'personal' });
    let all = await call('GET', '/profiles');
    expect(all.default).toBe('personal');
    expect(all.profiles.map((x: any) => x.id)).not.toContain(p.id);
    expect(all.deleted.map((x: any) => x.id)).toContain(p.id);
    // A device still asking for it gets a clear answer, and Claude cannot reach it.
    expect((await call('GET', '/today', undefined, { ...m, expect: 400 })).code).toBe('unknown_mode');
    expect(await toolError('list_projects', { mode: p.id })).toMatch(/No profile/);
    // A new profile with the same name gets another id, so the deleted one can still come back.
    const again = await call('POST', '/profiles', { label: p.label }, { expect: 201 });
    expect(again.profile.id).not.toBe(p.id);
    // Restore: everything is back, under "(restored)" because the name is taken now.
    const back = await call('POST', `/profiles/${p.id}/restore`);
    expect(back.restored).toMatchObject({ id: p.id, label: `${p.label} (restored)` });
    expect(back.default).toBe(p.id); // it was the default
    expect((await call('GET', '/projects', undefined, m)).map((x: any) => x.name)).toEqual(['Still here']);
    expect(await flagOf('plan-week', p.id)).toBe(false);
    await call('POST', `/profiles/${p.id}/restore`, undefined, { expect: 404 });
    await call('PUT', '/profiles/default', { id: 'personal' });
    // Delete now: gone for good.
    await call('POST', `/profiles/${p.id}/delete`, { confirm: `${p.label} (restored)` });
    await call('POST', `/profiles/${p.id}/purge`, { confirm: 'nope' }, { expect: 400 });
    await call('POST', `/profiles/${p.id}/purge`, { confirm: `${p.label} (restored)` });
    expect(await rowsLeft(p.id)).toBe(0);
    all = await call('GET', '/profiles');
    expect(all.deleted.map((x: any) => x.id)).not.toContain(p.id);
    await call('POST', `/profiles/${p.id}/restore`, undefined, { expect: 404 });
    // Personal and Work are untouched.
    expect((await call('GET', '/modes')).map((x: any) => x.id)).toEqual(expect.arrayContaining(['personal', 'work']));
  });

  it('purges a deleted profile after a week', async () => {
    const p = await fresh();
    await call('POST', '/projects', { name: 'Old stuff' }, { mode: p.id });
    await call('POST', `/profiles/${p.id}/delete`, { confirm: p.label });
    expect(await purgeExpired(env.DB, new Date(Date.now() + 6 * 86400_000))).toEqual([]);
    expect(await rowsLeft(p.id)).toBeGreaterThan(0);
    expect(await purgeExpired(env.DB, new Date(Date.now() + 8 * 86400_000))).toEqual([p.id]);
    expect(await rowsLeft(p.id)).toBe(0);
  });

  it('knows every table that has a mode column', async () => {
    const tables = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite%' AND name != 'd1_migrations'").all<{ name: string }>()).results;
    const withMode: string[] = [];
    for (const t of tables) {
      const cols = (await env.DB.prepare(`SELECT name FROM pragma_table_info(?)`).bind(t.name).all<{ name: string }>()).results;
      if (cols.some((c) => c.name === 'mode')) withMode.push(t.name);
    }
    expect(withMode.length).toBeGreaterThan(10);
    expect(modeTables().sort()).toEqual(expect.arrayContaining(withMode.sort()));
  });
});

describe('Claude’s profile tools', () => {
  it('lists, creates with copied settings, updates, sets the default, deletes and restores', async () => {
    const list = await tool('list_profiles');
    expect(list.profiles.map((p: any) => p.id)).toEqual(expect.arrayContaining(['personal', 'work']));
    await call('PUT', '/features/insights', { enabled: false }, { mode: 'work' });
    const made = await tool('create_profile', { label: 'From Claude', color: '#336699', copy_from: 'work' });
    const id = made.profile.id;
    expect(await flagOf('insights', id)).toBe(false);
    await call('PUT', '/features/insights', { enabled: true }, { mode: 'work' });
    const up = await tool('update_profile', { id, label: 'Claude’s profile', position: 1 });
    expect(up).toMatchObject({ label: 'Claude’s profile' });
    expect((await tool('list_profiles')).profiles[0].id).toBe(id);
    expect((await tool('set_default_profile', { id })).default).toBe(id);
    await tool('create_project', { name: 'In the new one', mode: id });
    expect(await toolError('delete_profile', { id, confirm_name: 'wrong' })).toMatch(/send its name/);
    const del = await tool('delete_profile', { id, confirm_name: 'Claude’s profile' });
    expect(del.removed).toContainEqual({ kind: 'projects', singular: 'project', count: 1 });
    expect((await tool('list_profiles')).default).toBe('personal');
    expect((await tool('restore_profile', { id })).restored.id).toBe(id);
    expect((await tool('list_projects', { mode: id })).map((p: any) => p.name)).toContain('In the new one');
    await tool('set_default_profile', { id: 'personal' });
    await tool('delete_profile', { id, confirm_name: 'Claude’s profile' });
  });
});

describe('the last profile', () => {
  it('cannot be deleted', async () => {
    // Leave one profile (raw, then put the rows back), so the rule is checked on its own.
    const saved = (await env.DB.prepare("SELECT * FROM modes WHERE id != 'personal'").all<Record<string, unknown>>()).results;
    await env.DB.exec("DELETE FROM modes WHERE id != 'personal'");
    try {
      expect((await call('POST', '/profiles/personal/delete', { confirm: 'Personal' }, { expect: 400 })).error).toMatch(/last profile/);
    } finally {
      for (const r of saved) {
        const k = Object.keys(r);
        await env.DB.prepare(`INSERT INTO modes (${k.join(', ')}) VALUES (${k.map(() => '?').join(', ')})`).bind(...k.map((x) => r[x])).run();
      }
    }
  });
});
