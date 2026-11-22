import { describe, expect, it } from 'vitest';
import { call } from './helpers';

describe('category buttons', () => {
  it('has the category-buttons flag, on by default, per profile', async () => {
    const find = async (m?: object) => (await call('GET', '/features', undefined, m)).find((x: any) => x.id === 'category-buttons');
    expect(await find()).toMatchObject({ enabled: true, label: 'Category buttons' });
    await call('PUT', '/features/category-buttons', { enabled: false });
    expect((await find()).enabled).toBe(false);
    await call('POST', '/modes', { label: 'Buttons', id: 'buttons' });
    expect((await find({ mode: 'buttons' })).enabled).toBe(true);
    await call('PUT', '/features/category-buttons', { enabled: true });
  });
});
