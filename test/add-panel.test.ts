import { describe, expect, it } from 'vitest';
import { call, tool, toolError } from './helpers';

let n = 0;
async function freshMode() {
  const m = await call('POST', '/modes', { label: `Add panel test ${++n} ${Math.random().toString(36).slice(2, 6)}` });
  return { mode: m.id as string };
}

describe('add panel', () => {
  it('puts a file on Today and in a saved pill in one undo step', async () => {
    const m = await freshMode();
    const note = await call('POST', '/lists', { name: 'Ideas', kind: 'note' }, m);
    await call('PUT', '/layout/today/pills', { pills: [{ id: 'home', name: 'Home', panels: ['habits'] }] }, m);
    const out = await call('POST', '/layout/today/add', { file: { type: 'note', id: note.id }, pill: 'home' }, m);
    expect(out.panel).toBe(`list-${note.id}`);
    expect((await call('GET', `/lists/${note.id}`, undefined, m)).show_today).toBe(true);
    expect((await call('GET', '/layout/today', undefined, m)).pills[0].panels).toEqual(['habits', `list-${note.id}`]);
    // Adding again changes nothing.
    await call('POST', '/layout/today/add', { panel: `list-${note.id}`, pill: 'home' }, m);
    expect((await call('GET', '/layout/today', undefined, m)).pills[0].panels).toEqual(['habits', `list-${note.id}`]);
    // One Undo takes both back (the second add saved nothing).
    await call('POST', '/undo', {}, m);
    expect((await call('GET', `/lists/${note.id}`, undefined, m)).show_today).toBe(false);
    expect((await call('GET', '/layout/today', undefined, m)).pills[0].panels).toEqual(['habits']);
  });

  it('saves the usual pills the app sent when none are saved', async () => {
    const m = await freshMode();
    const board = await call('POST', '/whiteboards', { name: 'Plan' }, m);
    const usual = [
      { id: 'today', name: 'Today', icon: '🎯', panels: ['today-list'] },
      { id: 'more', name: 'More', icon: null, panels: ['neglected'] },
    ];
    await call('POST', '/layout/today/add', { file: { type: 'whiteboard', id: board.id }, pill: 'today', pills: usual }, m);
    const l = await call('GET', '/layout/today', undefined, m);
    expect(l.pills.map((p: { panels: string[] }) => p.panels)).toEqual([['today-list', `wb-${board.id}`], ['neglected']]);
    expect((await call('GET', `/whiteboards/${board.id}`, undefined, m)).show_today).toBe(true);
  });

  it('puts a project’s notes on Today, making the note when needed', async () => {
    const m = await freshMode();
    const p = await call('POST', '/projects', { name: 'Garden' }, m);
    await call('POST', '/layout/today/add', { file: { type: 'project-note', id: p.id } }, m);
    const panels = await call('GET', '/today-panels', undefined, m);
    expect(panels.map((x: { key: string }) => x.key)).toContain(`project:${p.id}`);
    await call('POST', '/layout/today/remove', { panel: `pnote-${p.id}` }, m);
    expect((await call('GET', '/today-panels', undefined, m)).map((x: { key: string }) => x.key)).not.toContain(`project:${p.id}`);
  });

  it('brings a removed feature panel back, on Today and on project pages', async () => {
    const m = await freshMode();
    await call('PUT', '/layout/today/grid', { items: {}, removed: ['habits', 'neglected'] }, m);
    await call('POST', '/layout/today/add', { panel: 'habits' }, m);
    expect((await call('GET', '/layout/today', undefined, m)).grid.removed).toEqual(['neglected']);
    await call('POST', '/layout/project/remove', { panel: 'criteria' }, m);
    expect((await call('GET', '/layout/project', undefined, m)).grid.removed).toEqual(['criteria']);
    await call('POST', '/layout/project/add', { panel: 'criteria' }, m);
    expect((await call('GET', '/layout/project', undefined, m)).grid.removed).toEqual([]);
  });

  it('takes a file off Today and out of every pill; another panel only out of the pill', async () => {
    const m = await freshMode();
    const list = await call('POST', '/lists', { name: 'Shop', kind: 'todo', show_today: true }, m);
    const id = `list-${list.id}`;
    await call('PUT', '/layout/today/pills', { pills: [{ id: 'a', name: 'A', panels: [id, 'habits'] }, { id: 'b', name: 'B', panels: ['habits', id] }] }, m);
    await call('POST', '/layout/today/remove', { panel: 'habits', pill: 'a' }, m);
    let pills = (await call('GET', '/layout/today', undefined, m)).pills;
    expect(pills.map((p: { panels: string[] }) => p.panels)).toEqual([[id], ['habits', id]]);
    await call('POST', '/layout/today/remove', { file: { type: 'todo', id: list.id }, pill: 'a' }, m);
    pills = (await call('GET', '/layout/today', undefined, m)).pills;
    expect(pills.map((p: { panels: string[] }) => p.panels)).toEqual([[], ['habits']]);
    expect((await call('GET', `/lists/${list.id}`, undefined, m)).show_today).toBe(false);
  });

  it('refuses what cannot be a panel', async () => {
    const m = await freshMode();
    const bad = async (path: string, body: unknown) => (await call('POST', path, body, { ...m, expect: 400 })).error as string;
    const link = await call('POST', '/resources', { type: 'link', title: 'Site', value: 'https://example.com', folder_id: null }, m);
    expect(await bad('/layout/today/add', { file: { type: 'link', id: link.id } })).toContain('cannot be a panel');
    expect(await bad('/layout/today/add', { panel: 'habits', pill: 'nope' })).toContain('no saved pills');
    await call('PUT', '/layout/today/pills', { pills: [{ id: 'a', name: 'A', panels: [] }] }, m);
    expect(await bad('/layout/today/add', { panel: 'habits', pill: 'nope' })).toContain('No pill');
    expect(await bad('/layout/today/add', { panel: 'no spaces' })).toContain('panel id');
    const note = await call('POST', '/lists', { name: 'N', kind: 'note' }, m);
    expect(await bad('/layout/project/add', { file: { type: 'note', id: note.id } })).toContain('project’s folder');
    expect(await bad('/layout/elsewhere/add', { panel: 'habits' })).toContain('today, project or desktop');
    await call('POST', '/layout/today/add', { file: { type: 'note', id: 'missing' } }, { ...m, expect: 404 });
  });

  it('Claude can add and remove panels and files', async () => {
    const note = await tool('create_list', { name: `Claude note ${Math.random().toString(36).slice(2, 6)}`, kind: 'note' });
    const out = await tool('add_panel', { file_type: 'note', file_id: note.id });
    expect(out.panel).toBe(`list-${note.id}`);
    expect(out.file.on_today).toBe(true);
    const gone = await tool('remove_panel', { panel: `list-${note.id}` });
    expect(gone.file.on_today).toBe(false);
    expect(await toolError('add_panel', { page: 'project', file_type: 'note', file_id: note.id })).toContain('move_files');
    await tool('delete_item', { kind: 'lists', id: note.id });
  });
});

describe('desktop page (D64)', () => {
  it('keeps its own panels: a file goes on the Desktop, not on Today', async () => {
    const m = await freshMode();
    const note = await call('POST', '/lists', { name: 'Groceries', kind: 'note' }, m);
    let l = await call('GET', '/layout/desktop', undefined, m);
    expect(l.panels).toBeNull();
    expect(l.usual).toEqual(['focus', 'today-list', 'todos']);
    const out = await call('POST', '/layout/desktop/add', { file: { type: 'note', id: note.id } }, m);
    expect(out.panel).toBe(`list-${note.id}`);
    expect((await call('GET', `/lists/${note.id}`, undefined, m)).show_today).toBe(false);
    l = await call('GET', '/layout/desktop', undefined, m);
    expect(l.panels).toEqual(['focus', 'today-list', 'todos', `list-${note.id}`]);
    // Adding again changes nothing; Today's own layout has no panels list.
    await call('POST', '/layout/desktop/add', { panel: `list-${note.id}` }, m);
    expect((await call('GET', '/layout/desktop', undefined, m)).panels).toHaveLength(4);
    expect((await call('GET', '/layout/today', undefined, m)).panels).toBeUndefined();
    await call('POST', '/layout/desktop/remove', { panel: 'focus' }, m);
    expect((await call('GET', '/layout/desktop', undefined, m)).panels).toEqual(['today-list', 'todos', `list-${note.id}`]);
    await call('POST', '/undo', {}, m);
    expect((await call('GET', '/layout/desktop', undefined, m)).panels).toContain('focus');
  });

  it('taking a file off Today leaves it on the Desktop', async () => {
    const m = await freshMode();
    const list = await call('POST', '/lists', { name: 'Shop', kind: 'todo', show_today: true }, m);
    await call('POST', '/layout/desktop/add', { file: { type: 'todo', id: list.id } }, m);
    await call('POST', '/layout/today/remove', { file: { type: 'todo', id: list.id } }, m);
    expect((await call('GET', '/layout/desktop', undefined, m)).panels).toContain(`list-${list.id}`);
    await call('POST', '/layout/desktop/remove', { file: { type: 'todo', id: list.id } }, m);
    expect((await call('GET', '/layout/desktop', undefined, m)).panels).not.toContain(`list-${list.id}`);
  });

  it('a deleted file leaves the Desktop, and Undo puts it back', async () => {
    const m = await freshMode();
    const note = await call('POST', '/lists', { name: 'Gone soon', kind: 'note' }, m);
    await call('POST', '/layout/desktop/add', { file: { type: 'note', id: note.id } }, m);
    await call('DELETE', `/lists/${note.id}`, undefined, m);
    expect((await call('GET', '/layout/desktop', undefined, m)).panels).toEqual(['focus', 'today-list', 'todos']);
    await call('POST', '/undo', {}, m);
    expect((await call('GET', '/layout/desktop', undefined, m)).panels).toContain(`list-${note.id}`);
  });

  it('refuses pills on the Desktop', async () => {
    const m = await freshMode();
    const err = (await call('POST', '/layout/desktop/add', { panel: 'habits', pill: 'a' }, { ...m, expect: 400 })).error as string;
    expect(err).toContain('no pills');
  });

  it('Claude can read and change the Desktop', async () => {
    const note = await tool('create_list', { name: `Desk note ${Math.random().toString(36).slice(2, 6)}`, kind: 'note' });
    await tool('set_page_layout', { page: 'desktop', panels: null, grid: null });
    const out = await tool('add_panel', { page: 'desktop', file_type: 'note', file_id: note.id });
    expect(out.panel).toBe(`list-${note.id}`);
    let l = await tool('get_page_layout', { page: 'desktop' });
    expect(l.panels).toContain(`list-${note.id}`);
    await tool('set_page_layout', { page: 'desktop', panels: ['habits', `list-${note.id}`] });
    l = await tool('get_page_layout', { page: 'desktop' });
    expect(l.panels).toEqual(['habits', `list-${note.id}`]);
    await tool('remove_panel', { page: 'desktop', panel: 'habits' });
    expect((await tool('get_page_layout', { page: 'desktop' })).panels).toEqual([`list-${note.id}`]);
    expect(await toolError('set_page_layout', { page: 'today', panels: [] })).toContain('Only the Desktop');
    await tool('set_page_layout', { page: 'desktop', panels: null });
    await tool('delete_item', { kind: 'lists', id: note.id });
  });
});
