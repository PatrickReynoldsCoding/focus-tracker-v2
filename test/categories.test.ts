import { describe, expect, it } from 'vitest';
import { call, tool, toolError } from './helpers';

describe('manage categories', () => {
  it('keeps colour as a palette name or #rrggbb, and a name', async () => {
    const a = await call('POST', '/categories', { label: '  Garden ', color: '#A1B2C3' });
    expect(a).toMatchObject({ label: 'Garden', color: '#a1b2c3' });
    expect((await call('PATCH', `/categories/${a.id}`, { color: 'teal' })).color).toBe('teal');
    expect((await call('PATCH', `/categories/${a.id}`, { color: '' })).color).toBeNull();
    await call('PATCH', `/categories/${a.id}`, { color: 'fuchsia' }, { expect: 400 });
    await call('PATCH', `/categories/${a.id}`, { label: '   ' }, { expect: 400 });
    await call('POST', '/categories', { label: 'Bad', color: '#12' }, { expect: 400 });
  });

  it('orders categories and moves them', async () => {
    const [x, y, z] = [await call('POST', '/categories', { label: 'Ord X' }), await call('POST', '/categories', { label: 'Ord Y' }), await call('POST', '/categories', { label: 'Ord Z' })];
    await call('POST', `/categories/${z.id}/move`, { before_id: x.id });
    const names = (await call('GET', '/categories')).map((c: any) => c.label).filter((l: string) => l.startsWith('Ord '));
    expect(names).toEqual(['Ord Z', 'Ord X', 'Ord Y']);
    await tool('move_category', { id: y.id, index: 0 });
    const after = (await tool('list_categories')).map((c: any) => c.label);
    expect(after[0]).toBe('Ord Y');
  });

  it('counts what uses a category, and deleting detaches it in one undo step', async () => {
    const c = await tool('create_category', { label: 'Used', color: 'blue' });
    const p = await call('POST', '/projects', { name: 'Uses category', category_id: c.id });
    await call('POST', '/habits', { name: 'Uses it too', category_id: c.id });
    expect((await call('GET', '/categories/usage'))[c.id]).toEqual({ projects: 1, habits: 1 });
    expect((await tool('list_categories')).find((x: any) => x.id === c.id).uses).toEqual({ projects: 1, habits: 1 });
    expect(await toolError('update_category', { id: c.id, color: 'nope' })).toMatch(/color/);
    await call('DELETE', `/categories/${c.id}`, undefined, { expect: 400 });
    await call('POST', `/categories/${c.id}/delete`, {});
    expect((await call('GET', `/projects/${p.id}`)).category_id).toBeNull();
    expect((await call('GET', '/categories')).some((x: any) => x.id === c.id)).toBe(false);
    await call('POST', '/undo', {});
    expect((await call('GET', `/projects/${p.id}`)).category_id).toBe(c.id);
    expect((await call('GET', '/categories')).some((x: any) => x.id === c.id)).toBe(true);
    await tool('delete_category', { id: c.id });
    expect((await call('GET', `/projects/${p.id}`)).category_id).toBeNull();
  });

  it('keeps each profile’s categories apart', async () => {
    await call('POST', '/modes', { label: 'Cat profile', id: 'cat-profile' });
    const c = await call('POST', '/categories', { label: 'Elsewhere' }, { mode: 'cat-profile' });
    expect((await call('GET', '/categories')).some((x: any) => x.id === c.id)).toBe(false);
    expect((await call('GET', '/categories/usage', undefined, { mode: 'cat-profile' }))[c.id]).toBeUndefined();
  });
});
