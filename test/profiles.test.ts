// Profiles: the menu bar's red number and "Not today", and the profile open in the app being the default for clients that send none.
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { apiToken, BASE, call } from './helpers';

const text = async (headers: Record<string, string> = {}) =>
  (await SELF.fetch(`${BASE}/api/swiftbar`, { headers: { Authorization: `Bearer ${await apiToken()}`, ...headers } })).text();

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
