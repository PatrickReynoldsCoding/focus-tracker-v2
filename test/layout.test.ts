import { describe, expect, it } from 'vitest';
import { call, tool, toolError, flagEverywhere } from './helpers';

let n = 0;
/** A fresh mode, so each test starts with no saved layout and an empty undo history. */
async function freshMode() {
  const m = await call('POST', '/modes', { label: `Layout test ${++n} ${Math.random().toString(36).slice(2, 6)}` });
  return { mode: m.id as string };
}

describe('desktop layout', () => {
  it('saves a page’s grid per mode and reads it back', async () => {
    const m = await freshMode();
    expect(await call('GET', '/layout/today', undefined, m)).toEqual({ grid: null, pills: null, grids: {}, view: {} });
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

  it('keeps a phone height apart from the computer’s', async () => {
    const m = await freshMode();
    const grid = { items: { habits: { x: 0, y: 0, w: 6, h: 300, ph: 180 }, todos: { x: 6, y: 10, w: 6, ph: 240 } }, removed: [] };
    expect(await call('PUT', '/layout/today/grid', grid, m)).toEqual(grid);
    const pill = await call('PUT', '/layout/today/grids/today', { items: { habits: { x: 0, y: 0, w: 12, ph: 120 } } }, m);
    expect(pill.items.habits).toEqual({ x: 0, y: 0, w: 12, ph: 120 });
  });

  it('refuses places off the grid and odd ids', async () => {
    const m = await freshMode();
    const bad = async (body: unknown) => (await call('PUT', '/layout/today/grid', body, { ...m, expect: 400 })).error as string;
    expect(await bad({ items: { a: { x: 8, y: 0, w: 6 } } })).toContain('right edge');
    expect(await bad({ items: { a: { x: 0, y: 0, w: 13 } } })).toContain('a.w');
    expect(await bad({ items: { a: { x: -1, y: 0, w: 2 } } })).toContain('a.x');
    expect(await bad({ items: { a: { x: 0, y: 0.5, w: 2 } } })).toContain('a.y');
    expect(await bad({ items: { a: { x: 0, y: 0, w: 2, h: 10 } } })).toContain('a.h');
    expect(await bad({ items: { a: { x: 0, y: 0, w: 2, ph: 5000 } } })).toContain('a.ph');
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
    await flagEverywhere('movable-panels', false);
    try {
      await call('PUT', '/layout/today/grid', { items: {} }, { ...m, expect: 404 });
      // Reading still works (the page draws in the usual order).
      await call('GET', '/layout/today', undefined, m);
    } finally {
      await flagEverywhere('movable-panels', true);
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
    expect((await call('PUT', '/layout/today/view', { pillAll: false }, m)).pillAll).toBe(false);
    await call('PUT', '/layout/today/view', { pillAll: true }, m);
    expect((await call('PUT', '/layout/today/view', { focusCard: 'huge' }, { ...m, expect: 400 })).error).toContain('focusCard');
    expect((await call('PUT', '/layout/today/view', { pillSwipe: 'yes' }, { ...m, expect: 400 })).error).toContain('true or false');
    expect((await call('PUT', '/layout/today/view', { colour: 'red' }, { ...m, expect: 400 })).error).toContain('Unknown setting');
    expect((await call('GET', '/layout/today', undefined, m)).view).toEqual({ focusCard: 'hidden', pillCounts: false, pillLast: true, pillAll: true });
  });

  it('has the layout flags on by default', async () => {
    const list = await call('GET', '/features');
    for (const id of ['movable-panels', 'today-pills', 'popout-windows']) expect(list.find((f: any) => f.id === id)?.enabled).toBe(true);
  });

  it('has the computer’s pills off by default, per profile, and the pill tools still work', async () => {
    const m = await freshMode();
    const flag = async () => (await call('GET', '/features', undefined, m)).find((f: any) => f.id === 'desktop-pills');
    expect(await flag()).toMatchObject({ label: 'Today pills on a computer', enabled: false });
    expect((await call('GET', '/features')).find((f: any) => f.id === 'desktop-pills')?.enabled).toBe(false);
    await call('PUT', '/features/desktop-pills', { enabled: true }, m);
    expect((await flag()).enabled).toBe(true);
    expect((await call('GET', '/layout/today', undefined, m)).view).toBeDefined();
  });
});

describe('a pill’s own grid', () => {
  it('saves each pill’s grid apart from the page’s, and drops grids of deleted pills', async () => {
    const m = await freshMode();
    const page = { items: { todos: { x: 0, y: 0, w: 6 } }, removed: ['neglected'] };
    await call('PUT', '/layout/today/grid', page, m);
    const g = { items: { habits: { x: 6, y: 0, w: 6, h: 200 }, todos: { x: 0, y: 10, w: 12 } }, removed: ['ignored'] };
    // With no pills saved, the usual pills' ids work.
    expect(await call('PUT', '/layout/today/grids/today', g, m)).toEqual({ ...g, removed: [] });
    let d = await call('GET', '/layout/today', undefined, m);
    expect(d.grids).toEqual({ today: { ...g, removed: [] } });
    expect(d.grid).toEqual(page);
    // Pills saved: a grid of a pill that is gone is dropped on the next save.
    await call('PUT', '/layout/today/pills', { pills: [{ id: 'notes', name: 'Notes', panels: ['list-a'] }] }, m);
    await call('PUT', '/layout/today/grids/notes', { items: { 'list-a': { x: 0, y: 0, w: 4 } } }, m);
    d = await call('GET', '/layout/today', undefined, m);
    expect(Object.keys(d.grids)).toEqual(['notes']);
    // Checked like the page's grid.
    expect((await call('PUT', '/layout/today/grids/notes', { items: { a: { x: 10, y: 0, w: 4 } } }, { ...m, expect: 400 })).error).toContain('right edge');
    expect((await call('PUT', '/layout/today/grids/bad%20id', { items: {} }, { ...m, expect: 400 })).error).toContain('Unknown pill');
  });

  it('resets a pill’s grid, and Undo brings it back', async () => {
    const m = await freshMode();
    const g = { items: { habits: { x: 0, y: 0, w: 8 } }, removed: [] };
    await call('PUT', '/layout/today/grids/today', g, m);
    await call('DELETE', '/layout/today/grids/today', undefined, m);
    expect((await call('GET', '/layout/today', undefined, m)).grids).toEqual({});
    const u = await call('POST', '/undo', {}, m);
    expect(u.label).toContain('pill');
    expect((await call('GET', '/layout/today', undefined, m)).grids).toEqual({ today: g });
  });

  it('is refused while the pills or the grid are off', async () => {
    const m = await freshMode();
    for (const f of ['today-pills', 'movable-panels']) {
      await flagEverywhere(f, false);
      try {
        await call('PUT', '/layout/today/grids/today', { items: {} }, { ...m, expect: 404 });
      } finally {
        await flagEverywhere(f, true);
      }
    }
  });
});

describe('Claude and the pills', () => {
  it('reads the pills and the panel ids it can use', async () => {
    const list = await call('POST', '/lists', { name: 'Pill test list', kind: 'todo' });
    const out = await tool('get_today_pills');
    expect(out.pills === null || Array.isArray(out.pills)).toBe(true);
    // The Today list (flag today-panel, on) takes To do today's place; Habits can still be put in a pill.
    expect(out.panels.map((p: any) => p.id)).toEqual(expect.arrayContaining(['today-list', 'habits', `list-${list.id}`]));
    expect(out.panels.map((p: any) => p.id)).not.toContain('todos');
    expect(out.icons).toContain('🏠');
  });

  it('replaces the pills (undoable) and changes the switches', async () => {
    const before = (await call('GET', '/layout/today')).pills;
    const out = await tool('set_today_pills', { pills: [{ id: 'home', name: 'Home', icon: '🏠', panels: ['todos', 'habits'] }], view: { pillAll: false, focusCard: 'full' } });
    expect(out.pills).toEqual([{ id: 'home', name: 'Home', icon: '🏠', panels: ['todos', 'habits'] }]);
    expect(out.view).toMatchObject({ pillAll: false, focusCard: 'full' });
    expect(await toolError('set_today_pills', { pills: [{ id: 'x', name: '', panels: [] }] })).toContain('needs a name');
    expect(await toolError('set_today_pills', { pills: [], view: { colour: 'red' } })).toContain('Unknown setting');
    await call('POST', '/undo', {});
    expect((await call('GET', '/layout/today')).pills).toEqual(before);
    await tool('set_today_pills', { pills: null, view: { pillAll: true, focusCard: 'compact' } });
  });
});

describe('Claude and page layouts', () => {
  it('reads and replaces a page’s layout and a pill’s, undoably', async () => {
    const before = await tool('get_page_layout', { page: 'project' });
    const grid = { items: { board: { x: 0, y: 0, w: 12 }, notes: { x: 0, y: 10, w: 6, h: 320, ph: 200 } }, removed: ['criteria'] };
    const out = await tool('set_page_layout', { page: 'project', grid });
    expect(out.grid).toEqual(grid);
    expect((await call('GET', '/layout/project')).grid).toEqual(grid);
    expect(await toolError('set_page_layout', { page: 'project', grid: { items: { a: { x: 10, y: 0, w: 6 } } } })).toContain('right edge');
    await call('POST', '/undo', {});
    expect((await tool('get_page_layout', { page: 'project' })).grid).toEqual(before.grid);

    const pill = await tool('set_page_layout', { page: 'today', pill: 'today', grid: { items: { habits: { x: 6, y: 0, w: 6, ph: 150 } }, removed: ['x'] } });
    expect(pill.grid).toEqual({ items: { habits: { x: 6, y: 0, w: 6, ph: 150 } }, removed: [] });
    expect((await tool('get_page_layout', { page: 'today', pill: 'today' })).grid.items.habits.ph).toBe(150);
    await tool('set_page_layout', { page: 'today', pill: 'today', grid: null });
    expect((await tool('get_page_layout', { page: 'today', pill: 'today' })).grid).toBeNull();
  });
});
