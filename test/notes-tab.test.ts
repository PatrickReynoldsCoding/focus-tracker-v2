import { describe, expect, it } from 'vitest';
import { call } from './helpers';

describe('the Notes tab', () => {
  it('reorders lists with the generic move route and keeps the order in the overview', async () => {
    await call('POST', '/modes', { label: 'Notes order', id: 'notes-order' });
    const m = { mode: 'notes-order' };
    const a = await call('POST', '/lists', { name: 'A', kind: 'note' }, m);
    const b = await call('POST', '/lists', { name: 'B', kind: 'todo' }, m);
    const c = await call('POST', '/lists', { name: 'C', kind: 'list' }, m);
    const names = async () => (await call('GET', '/lists/overview', undefined, m)).map((l: any) => l.name);
    expect(await names()).toEqual(['A', 'B', 'C']);
    await call('POST', `/lists/${c.id}/move`, { index: 0 }, m);
    expect(await names()).toEqual(['C', 'A', 'B']);
    await call('POST', `/lists/${a.id}/move`, { after_id: b.id }, m);
    expect(await names()).toEqual(['C', 'B', 'A']);
    await call('POST', `/lists/${b.id}/move`, { before_id: c.id }, m);
    expect(await names()).toEqual(['B', 'C', 'A']);
    await call('POST', `/lists/${b.id}/move`, { before_id: 'nope' }, { ...m, expect: 400 });
    // undo puts the order back
    await call('POST', '/undo', {}, m);
    expect(await names()).toEqual(['C', 'B', 'A']);
  });

  it('does not move a list of another mode', async () => {
    const other = await call('POST', '/lists', { name: 'Elsewhere', kind: 'note' }, { mode: 'work' });
    await call('POST', `/lists/${other.id}/move`, { index: 0 }, { mode: 'personal', expect: 404 });
  });

  it('shows to-dos ticked today on a card, and counts them', async () => {
    await call('POST', '/modes', { label: 'Notes todos', id: 'notes-todos' });
    const m = { mode: 'notes-todos' };
    const l = await call('POST', '/lists', { name: 'Chores', kind: 'todo' }, m);
    const t1 = await call('POST', '/todos', { title: 'Wash up', list_id: l.id }, m);
    await call('POST', '/todos', { title: 'Hoover', list_id: l.id }, m);
    const card = async () => (await call('GET', '/lists/overview', undefined, m)).find((x: any) => x.id === l.id);
    let c = await card();
    expect(c).toMatchObject({ open: 2, done_today: 0 });
    expect(c.items.map((i: any) => i.title)).toEqual(['Wash up', 'Hoover']);
    expect(c.items[0].id).toBe(t1.id);
    await call('POST', `/todos/${t1.id}/tick`, { done: true }, m);
    c = await card();
    expect(c).toMatchObject({ open: 1, done_today: 1 });
    expect(c.items.map((i: any) => [i.title, !!i.done])).toEqual([['Hoover', false], ['Wash up', true]]);
    await call('POST', `/todos/${t1.id}/tick`, { done: false }, m);
    c = await card();
    expect(c).toMatchObject({ open: 2, done_today: 0 });
  });

  it('has a per-mode switch for project notes as cards', async () => {
    const work = { mode: 'work' };
    const p = await call('POST', '/projects', { name: 'Garden shed' }, work);
    const empty = await call('POST', '/projects', { name: 'No notes yet' }, work);
    await call('PUT', `/notes/of/project/${p.id}`, { body: '# Shed\nBuy **screws**' }, work);
    await call('PUT', `/notes/of/project/${empty.id}`, { body: '' }, work);
    // off by default: no cards at all
    expect(await call('GET', '/lists/project-notes', undefined, work)).toEqual({ on: false, notes: [] });
    const on = await call('PUT', '/lists/project-notes', { on: true }, work);
    expect(on.on).toBe(true);
    expect(on.notes).toHaveLength(1);
    expect(on.notes[0]).toMatchObject({ project_id: p.id, name: 'Garden shed', show_today: false });
    expect(on.notes[0].preview).toContain('screws');
    // per mode: the personal mode is still off, and does not see work's notes
    expect(await call('GET', '/lists/project-notes', undefined, { mode: 'personal' })).toEqual({ on: false, notes: [] });
    await call('PUT', '/lists/project-notes', { on: true }, { mode: 'personal' });
    expect((await call('GET', '/lists/project-notes', undefined, { mode: 'personal' })).notes.find((n: any) => n.project_id === p.id)).toBeUndefined();
    // a finished project drops out; switching off empties the list again
    await call('PATCH', `/projects/${p.id}`, { status: 'done' }, work);
    expect((await call('GET', '/lists/project-notes', undefined, work)).notes).toHaveLength(0);
    await call('PATCH', `/projects/${p.id}`, { status: 'active' }, work);
    expect((await call('GET', '/lists/project-notes', undefined, work)).notes).toHaveLength(1);
    expect(await call('PUT', '/lists/project-notes', { on: false }, work)).toEqual({ on: false, notes: [] });
    await call('PUT', '/lists/project-notes', { on: 'yes' }, { ...work, expect: 400 });
  });
});
