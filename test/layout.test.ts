import { describe, expect, it } from 'vitest';
import { call } from './helpers';

let n = 0;
/** A fresh mode, so each test starts with no saved layout and an empty undo history. */
async function freshMode() {
  const m = await call('POST', '/modes', { label: `Layout test ${++n} ${Math.random().toString(36).slice(2, 6)}` });
  return { mode: m.id as string };
}

describe('desktop layout', () => {
  it('saves a page’s grid per mode and reads it back', async () => {
    const m = await freshMode();
    expect(await call('GET', '/layout/today', undefined, m)).toEqual({ grid: null });
    const grid = { items: { focus: { x: 0, y: 0, w: 12 }, todos: { x: 6, y: 1, w: 6, h: 300 } }, removed: ['neglected'] };
    expect(await call('PUT', '/layout/today/grid', grid, m)).toEqual(grid);
    expect((await call('GET', '/layout/today', undefined, m)).grid).toEqual(grid);
    // Another page and another mode are untouched.
    expect((await call('GET', '/layout/project', undefined, m)).grid).toBeNull();
    const other = await freshMode();
    expect((await call('GET', '/layout/today', undefined, other)).grid).toBeNull();
    // Duplicates in removed are dropped.
    const again = await call('PUT', '/layout/project/grid', { items: {}, removed: ['notes', 'notes', 'list-abc'] }, m);
    expect(again.removed).toEqual(['notes', 'list-abc']);
  });

  it('refuses places off the grid and odd ids', async () => {
    const m = await freshMode();
    const bad = async (body: unknown) => (await call('PUT', '/layout/today/grid', body, { ...m, expect: 400 })).error as string;
    expect(await bad({ items: { a: { x: 8, y: 0, w: 6 } } })).toContain('right edge');
    expect(await bad({ items: { a: { x: 0, y: 0, w: 13 } } })).toContain('a.w');
    expect(await bad({ items: { a: { x: -1, y: 0, w: 2 } } })).toContain('a.x');
    expect(await bad({ items: { a: { x: 0, y: 0.5, w: 2 } } })).toContain('a.y');
    expect(await bad({ items: { a: { x: 0, y: 0, w: 2, h: 10 } } })).toContain('a.h');
    expect(await bad({ items: { 'no spaces': { x: 0, y: 0, w: 2 } } })).toContain('not a panel id');
    expect(await bad({ items: [] })).toContain('items');
    expect(await bad({ removed: ['<script>'] })).toContain('not a panel id');
    expect((await call('GET', '/layout/Bad%20Page', undefined, { ...m, expect: 400 })).error).toContain('Unknown page');
  });

  it('resets a page, and Undo brings the layout back', async () => {
    const m = await freshMode();
    const grid = { items: { focus: { x: 0, y: 0, w: 8 } }, removed: [] };
    await call('PUT', '/layout/project/grid', grid, m);
    await call('DELETE', '/layout/project/grid', undefined, m);
    const after = await call('GET', '/layout/project', undefined, m);
    expect(after.grid).toBeNull();
    const u = await call('POST', '/undo', {}, m);
    expect(u.label).toContain('reset');
    expect((await call('GET', '/layout/project', undefined, m)).grid).toEqual(grid);
  });

  it('is refused while the flag is off', async () => {
    const m = await freshMode();
    await call('PUT', '/features/movable-panels', { enabled: false });
    try {
      await call('PUT', '/layout/today/grid', { items: {} }, { ...m, expect: 404 });
      // Reading still works (the page draws in the usual order).
      await call('GET', '/layout/today', undefined, m);
    } finally {
      await call('PUT', '/features/movable-panels', { enabled: true });
    }
  });
});

describe('layout flags', () => {
  it('has movable-panels on by default', async () => {
    const list = await call('GET', '/features');
    expect(list.find((f: any) => f.id === 'movable-panels')?.enabled).toBe(true);
  });
});
