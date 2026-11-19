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
    expect(await call('GET', '/layout/today', undefined, m)).toEqual({ grid: null, pills: null, view: {} });
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
    await call('PUT', '/layout/project/pills', { pills: [{ id: 'a', name: 'A', panels: ['notes'] }] }, m);
    await call('DELETE', '/layout/project/grid', undefined, m);
    const after = await call('GET', '/layout/project', undefined, m);
    expect(after.grid).toBeNull();
    expect(after.pills).toHaveLength(1); // a reset of the desktop leaves the pills
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

describe('Today pills', () => {
  it('saves pills per mode, cleaned', async () => {
    const m = await freshMode();
    const out = await call(
      'PUT',
      '/layout/today/pills',
      { pills: [{ id: 'routine', name: '  Routine  ', icon: '🏠', panels: ['habits', 'todos', 'habits'] }, { id: 'shop', name: 'Shopping', icon: '', panels: ['list-abc123'] }] },
      m,
    );
    expect(out).toEqual([
      { id: 'routine', name: 'Routine', icon: '🏠', panels: ['habits', 'todos'] },
      { id: 'shop', name: 'Shopping', icon: null, panels: ['list-abc123'] },
    ]);
    expect((await call('GET', '/layout/today', undefined, m)).pills).toEqual(out);
    expect((await call('GET', '/layout/today', undefined, await freshMode())).pills).toBeNull();
  });

  it('checks names, icons, ids, panels and the number of pills', async () => {
    const m = await freshMode();
    const bad = async (pills: unknown) => (await call('PUT', '/layout/today/pills', { pills }, { ...m, expect: 400 })).error as string;
    const pill = (over: Record<string, unknown> = {}) => ({ id: 'p1', name: 'One', icon: null, panels: [], ...over });
    expect(await bad([pill({ name: '   ' })])).toContain('needs a name');
    expect(await bad([pill({ name: 'x'.repeat(25) })])).toContain('24 characters');
    // 24 emoji are 24 characters, not 48 code units.
    await call('PUT', '/layout/today/pills', { pills: [pill({ name: '✨'.repeat(24) })] }, m);
    expect(await bad([pill({ icon: '💩' })])).toContain('Unknown icon');
    expect(await bad([pill(), pill()])).toContain('Two pills');
    expect(await bad([pill({ id: 'has space' })])).toContain('no valid id');
    expect(await bad([pill({ panels: ['ok', 'not ok'] })])).toContain('not a panel id');
    expect(await bad([pill({ panels: Array.from({ length: 41 }, (_, i) => `p${i}`) })])).toContain('at most 40');
    expect(await bad(Array.from({ length: 13 }, (_, i) => pill({ id: `p${i}` })))).toContain('At most 12');
    expect(await bad('nope')).toContain('list');
  });

  it('undoes and redoes pill changes, the first one back to no pills', async () => {
    const m = await freshMode();
    const one = [{ id: 'a', name: 'A', icon: null, panels: ['todos'] }];
    const two = [...one, { id: 'b', name: 'B', icon: '📚', panels: ['habits'] }];
    await call('PUT', '/layout/today/pills', { pills: one }, m);
    await call('PUT', '/layout/today/pills', { pills: two }, m);
    const u = await call('POST', '/undo', {}, m);
    expect(u.label).toContain('pills');
    expect((await call('GET', '/layout/today', undefined, m)).pills).toEqual(one);
    await call('POST', '/undo', {}, m);
    expect((await call('GET', '/layout/today', undefined, m)).pills).toBeNull();
    await call('POST', '/redo', {}, m);
    expect((await call('GET', '/layout/today', undefined, m)).pills).toEqual(one);
    await call('POST', '/redo', {}, m);
    expect((await call('GET', '/layout/today', undefined, m)).pills).toEqual(two);
    // Reset: back to no pills (the default), and Undo brings them back.
    await call('DELETE', '/layout/today/pills', undefined, m);
    expect((await call('GET', '/layout/today', undefined, m)).pills).toBeNull();
    await call('POST', '/undo', {}, m);
    expect((await call('GET', '/layout/today', undefined, m)).pills).toEqual(two);
  });

  it('keeps the switches, merged and checked', async () => {
    const m = await freshMode();
    expect(await call('PUT', '/layout/today/view', { focusCard: 'hidden' }, m)).toEqual({ focusCard: 'hidden' });
    expect(await call('PUT', '/layout/today/view', { pillCounts: false, pillLast: true }, m)).toEqual({ focusCard: 'hidden', pillCounts: false, pillLast: true });
    expect((await call('PUT', '/layout/today/view', { focusCard: 'huge' }, { ...m, expect: 400 })).error).toContain('focusCard');
    expect((await call('PUT', '/layout/today/view', { pillSwipe: 'yes' }, { ...m, expect: 400 })).error).toContain('true or false');
    expect((await call('PUT', '/layout/today/view', { colour: 'red' }, { ...m, expect: 400 })).error).toContain('Unknown setting');
    expect((await call('GET', '/layout/today', undefined, m)).view).toEqual({ focusCard: 'hidden', pillCounts: false, pillLast: true });
  });

  it('has the layout flags on by default', async () => {
    const list = await call('GET', '/features');
    for (const id of ['movable-panels', 'today-pills', 'popout-windows']) expect(list.find((f: any) => f.id === id)?.enabled).toBe(true);
  });
});
