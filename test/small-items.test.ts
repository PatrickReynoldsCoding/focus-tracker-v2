import { describe, expect, it } from 'vitest';
import { call, tool } from './helpers';

describe('categories in use', () => {
  it('refuses to delete a category that projects use, and says how many', async () => {
    const cat = await call('POST', '/categories', { label: 'Coding' });
    await call('POST', '/projects', { name: 'A', category_id: cat.id });
    await call('POST', '/projects', { name: 'B', category_id: cat.id });
    await call('POST', '/habits', { name: 'Practise', category_id: cat.id });
    const res = await call('DELETE', `/categories/${cat.id}`, undefined, { expect: 400 });
    expect(res.error).toContain('2 projects');
    expect(res.error).toContain('1 habit');
    const free = await call('POST', '/categories', { label: 'Empty' });
    await call('DELETE', `/categories/${free.id}`);
  });
});

describe('redo', () => {
  it('re-applies an undone change, in order, and a new change clears it', async () => {
    const m = { mode: 'work' };
    const p = await call('POST', '/projects', { name: 'One' }, m);
    await call('PATCH', `/projects/${p.id}`, { name: 'Two' }, m);
    await call('POST', '/undo', {}, m);
    await call('POST', '/undo', {}, m);
    await call('GET', `/projects/${p.id}`, undefined, { ...m, expect: 404 });
    let r = await call('POST', '/redo', {}, m);
    expect(r.changes).toBeGreaterThan(0);
    expect((await call('GET', `/projects/${p.id}`, undefined, m)).name).toBe('One');
    r = await call('POST', '/redo', {}, m);
    expect((await call('GET', `/projects/${p.id}`, undefined, m)).name).toBe('Two');
    expect(await call('POST', '/redo', {}, m)).toEqual({ label: null, changes: 0 });
    // undo, then a new change: nothing to redo
    await call('POST', '/undo', {}, m);
    await call('POST', '/projects', { name: 'Three' }, m);
    expect(await call('POST', '/redo', {}, m)).toEqual({ label: null, changes: 0 });
  });

  it('redoes a delete with its cascade, and is a Claude tool', async () => {
    const p = await call('POST', '/projects', { name: 'Doomed' });
    await call('POST', '/tasks', { project_id: p.id, title: 'Card' });
    await call('DELETE', `/projects/${p.id}`);
    await tool('undo');
    expect((await call('GET', `/tasks?project_id=${p.id}`)).length).toBe(1);
    await tool('redo');
    await call('GET', `/projects/${p.id}`, undefined, { expect: 404 });
    expect(await call('GET', `/tasks?project_id=${p.id}`)).toEqual([]);
  });
});

describe('modes', () => {
  it('adds a mode with a colour, and deletes it only when empty', async () => {
    const m = await call('POST', '/modes', { label: 'Side projects', color: '#3366cc' });
    expect(m).toMatchObject({ id: 'side-projects', color: '#3366cc' });
    await call('PATCH', `/modes/${m.id}`, { color: 'blue' }, { expect: 400 });
    await call('PATCH', `/modes/${m.id}`, { label: 'Side', color: '#112233' });
    await call('POST', '/projects', { name: 'X' }, { mode: m.id });
    const err = await call('DELETE', `/modes/${m.id}`, undefined, { expect: 400 });
    expect(err.error).toContain('1 project');
    const e = await call('POST', '/modes', { label: 'Empty mode' });
    await call('DELETE', `/modes/${e.id}`);
  });
});

describe('log lines', () => {
  it('edits and deletes a session line, with undo', async () => {
    const p = await call('POST', '/projects', { name: 'Logged' });
    const l = await call('POST', '/log', { project_id: p.id, date: '2026-11-01', minutes: 25, where_stopped: 'old' });
    const u = await call('PATCH', `/log/${l.id}`, { date: '2026-11-02', minutes: 40, where_stopped: 'new' });
    expect(u).toMatchObject({ date: '2026-11-02', minutes: 40, where_stopped: 'new' });
    await call('PATCH', `/log/${l.id}`, { date: 'tomorrow' }, { expect: 400 });
    await call('DELETE', `/log/${l.id}`);
    await call('POST', '/undo');
    expect((await call('GET', `/log/${l.id}`)).minutes).toBe(40);
  });
});
