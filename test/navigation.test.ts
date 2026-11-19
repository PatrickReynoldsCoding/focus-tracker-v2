import { describe, expect, it } from 'vitest';
import { call } from './helpers';

describe('navigation flags', () => {
  it('has swipe-tabs on by default and the owner can switch it off and on', async () => {
    const find = async () => (await call('GET', '/features')).find((x: any) => x.id === 'swipe-tabs');
    expect(await find()).toMatchObject({ enabled: true, label: 'Swipe between tabs' });
    await call('PUT', '/features/swipe-tabs', { enabled: false });
    expect((await find()).enabled).toBe(false);
    await call('PUT', '/features/swipe-tabs', { enabled: true });
    expect((await find()).enabled).toBe(true);
  });
});
