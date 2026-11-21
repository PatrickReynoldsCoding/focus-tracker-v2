// The Done column (D34, flag done-column): one fixed Done status per project, always last, not
// deletable; a card is done exactly while it is in it, whichever way it is changed; Hide done;
// Claude's tools; issue links; the flag off; and migration 0019 on boards made before it.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { statements } from '../src/core/migrate';
import { call, tool, toolError, flagEverywhere } from './helpers';
import migration from '../migrations/0019_done_column.sql';

let n = 0;
async function fresh() {
  const m = await call('POST', '/modes', { label: `Done ${++n} ${Math.random().toString(36).slice(2, 6)}` });
  return { mode: m.id as string };
}
const names = (cols: any[]) => cols.map((c) => c.name);
const flag = (on: boolean) => flagEverywhere('done-column', on);

describe('the Done column', () => {
  it('gives a new project To do, Doing and a fixed Done, and keeps Done last', async () => {
    const m = await fresh();
    const p = await call('POST', '/projects', { name: 'Shed' }, m);
    let full = await call('GET', `/projects/${p.id}/full`, undefined, m);
    expect(full.hide_done).toBe(false);
    expect(full.columns.map((c: any) => [c.name, c.is_done])).toEqual([['To do', false], ['Doing', false], ['Done', true]]);
    const done = full.columns[2];
    // A new column goes before Done.
    const waiting = await call('POST', '/columns', { project_id: p.id, name: 'Waiting' }, m);
    full = await call('GET', `/projects/${p.id}/full`, undefined, m);
    expect(names(full.columns)).toEqual(['To do', 'Doing', 'Waiting', 'Done']);
    // Moving a column after Done, or Done itself, leaves Done last.
    await call('POST', `/columns/${waiting.id}/move`, { after_id: done.id }, m);
    await call('POST', `/columns/${done.id}/move`, { index: 0 }, m);
    full = await call('GET', `/projects/${p.id}/full`, undefined, m);
    expect(names(full.columns)).toEqual(['To do', 'Doing', 'Waiting', 'Done']);
    await call('POST', `/columns/${waiting.id}/move`, { index: 0 }, m);
    expect(names((await call('GET', `/projects/${p.id}/full`, undefined, m)).columns)).toEqual(['Waiting', 'To do', 'Doing', 'Done']);
    // It can be renamed, not deleted, and there is only ever one.
    await call('PATCH', `/columns/${done.id}`, { name: 'Shipped' }, m);
    await call('DELETE', `/columns/${done.id}`, undefined, { ...m, expect: 400 });
    await call('PATCH', `/columns/${done.id}`, { is_done: false }, { ...m, expect: 400 });
    await call('POST', '/columns', { project_id: p.id, name: 'Done 2', is_done: true }, { ...m, expect: 400 });
    const l = await call('POST', '/lists', { name: 'Books', kind: 'list' }, m);
    await call('POST', '/columns', { list_id: l.id, name: 'Read', is_done: true }, { ...m, expect: 400 });
    await call('DELETE', `/columns/${waiting.id}`, undefined, m);
    // Deleting the project takes its Done column too.
    await call('DELETE', `/projects/${p.id}`, undefined, m);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM columns WHERE project_id = ?').bind(p.id).first('n')).toBe(0);
  });

  it('makes a card done exactly while it is in Done', async () => {
    const m = await fresh();
    const { day } = await call('GET', '/today', undefined, m);
    const p = await call('POST', '/projects', { name: 'Kitchen' }, m);
    const [todo, doing, done] = (await call('GET', `/projects/${p.id}/full`, undefined, m)).columns;
    let c = await call('POST', '/tasks', { title: 'Tiles', project_id: p.id }, m);
    expect([c.column_id, c.done]).toEqual([todo.id, null]);
    c = await call('POST', `/tasks/${c.id}/move`, { column_id: done.id }, m);
    expect(c.done).toBe(day);
    c = await call('POST', `/tasks/${c.id}/move`, { column_id: doing.id }, m);
    expect(c.done).toBeNull();
    // Setting done moves it into Done; clearing it moves it to the first column.
    c = await call('PATCH', `/tasks/${c.id}`, { done: day }, m);
    expect([c.column_id, c.done]).toEqual([done.id, day]);
    c = await call('PATCH', `/tasks/${c.id}`, { done: null }, m);
    expect([c.column_id, c.done]).toEqual([todo.id, null]);
    // Made in Done: done. Ticked in the Today list: in Done.
    expect((await call('POST', '/tasks', { title: 'Paint', column_id: done.id }, m)).done).toBe(day);
    const t = await call('POST', '/tasks', { title: 'Sink', project_id: p.id, day }, m);
    expect((await call('POST', `/tasks/${t.id}/tick`, { done: true }, m)).column_id).toBe(done.id);
    // The board says each card's status.
    const board = await call('GET', `/boards/project/${p.id}`, undefined, m);
    expect(board[2].cards.map((x: any) => [x.title, x.status])).toEqual([['Paint', 'Done'], ['Sink', 'Done']]);
  });

  it('remembers Hide done on the project', async () => {
    const m = await fresh();
    const p = await call('POST', '/projects', { name: 'Garage' }, m);
    await call('PATCH', `/projects/${p.id}`, { hide_done: true }, m);
    expect((await call('GET', `/projects/${p.id}/full`, undefined, m)).hide_done).toBe(true);
  });

  it('counts a card in Done (whatever its name) as finished for issue links', async () => {
    const m = await fresh();
    const p = await call('POST', '/projects', { name: 'Roof' }, m);
    const q = await call('POST', '/projects', { name: 'Loft' }, m);
    const done = (await call('GET', `/projects/${p.id}/full`, undefined, m)).columns[2];
    await call('PATCH', `/columns/${done.id}`, { name: 'Finished at last' }, m);
    const card = await call('POST', '/tasks', { project_id: p.id, title: 'Felt' }, m);
    await call('POST', '/links', { from_kind: 'tasks', from_id: card.id, type: 'blocks', to_kind: 'projects', to_id: q.id }, m);
    expect((await call('GET', `/projects/${q.id}/full`, undefined, m)).blocked_by).toHaveLength(1);
    await call('POST', `/tasks/${card.id}/move`, { column_id: done.id }, m);
    expect((await call('GET', `/projects/${q.id}/full`, undefined, m)).blocked_by).toEqual([]);
  });

  it('gives Claude status by column name, done, and hide_done', async () => {
    const m = await fresh();
    const p = await tool('create_project', { name: 'Novel', mode: m.mode });
    const card = await tool('add_card', { project_id: p.id, title: 'Plot', column: 'doing', mode: m.mode });
    let c = await tool('update_card', { id: card.id, status: 'Done', mode: m.mode });
    expect(c.done).not.toBeNull();
    c = await tool('update_card', { id: card.id, done: false, mode: m.mode });
    expect([c.column_id, c.done]).toEqual([p.columns[0].id, null]);
    c = await tool('update_card', { id: card.id, done: true, mode: m.mode });
    expect(c.column_id).toBe(p.columns[2].id);
    expect(await toolError('update_card', { id: card.id, status: 'Nope', mode: m.mode })).toContain('Columns: To do, Doing, Done');
    const b = await tool('get_board', { project_id: p.id, mode: m.mode });
    expect(b.map((x: any) => x.is_done)).toEqual([false, false, true]);
    expect(b[2].cards[0].status).toBe('Done');
    expect((await tool('update_project', { id: p.id, hide_done: true, mode: m.mode })).hide_done).toBe(true);
  });

  it('with the flag off: the last column means done, and Done can be deleted', async () => {
    const m = await fresh();
    const { day } = await call('GET', '/today', undefined, m);
    const p = await call('POST', '/projects', { name: 'Old way' }, m);
    const [todo, , done] = (await call('GET', `/projects/${p.id}/full`, undefined, m)).columns;
    await flag(false);
    try {
      const c = await call('POST', '/tasks', { title: 'X', project_id: p.id, day }, m);
      expect((await call('POST', `/tasks/${c.id}/move`, { column_id: done.id }, m)).done).toBe(day);
      const plain = await call('POST', '/tasks', { title: 'No day', column_id: todo.id }, m);
      expect((await call('POST', `/tasks/${plain.id}/move`, { column_id: done.id }, m)).done).toBeNull();
      await call('DELETE', `/columns/${done.id}`, undefined, m);
    } finally {
      await flag(true);
    }
    // On again: ticking makes a Done column for the board.
    const t = await call('POST', '/tasks', { title: 'Y', project_id: p.id }, m);
    const after = await call('POST', `/tasks/${t.id}/tick`, { done: true }, m);
    const cols = (await call('GET', `/projects/${p.id}/full`, undefined, m)).columns;
    expect(cols.at(-1)).toMatchObject({ name: 'Done', is_done: true, id: after.column_id });
  });
});

describe('migration 0019', () => {
  it('reuses the last done-like column, moves it last, adds Done where none, and sets done', async () => {
    const T = '2026-10-01T09:00:00.000Z';
    const M = 'personal';
    const col = (id: string, project: string, name: string, ord: number) =>
      env.DB.prepare('INSERT INTO columns (id, mode, project_id, name, ord, created, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, M, project, name, ord, T, T);
    const card = (id: string, project: string, column: string, done: string | null) =>
      env.DB.prepare('INSERT INTO tasks (id, mode, project_id, column_id, title, done, ord, created, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)').bind(id, M, project, column, id, done, T, T);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO projects (id, mode, name, status, ord, created, updated_at) VALUES ('mg-a', ?, 'A', 'active', 1, ?, ?), ('mg-b', ?, 'B', 'active', 2, ?, ?)").bind(M, T, T, M, T, T),
      col('mg-a1', 'mg-a', 'To do', 1),
      col('mg-a2', 'mg-a', ' complete ', 2),
      col('mg-a3', 'mg-a', 'Waiting', 3),
      col('mg-b1', 'mg-b', 'Ideas', 1),
      card('mg-c1', 'mg-a', 'mg-a2', null),
      card('mg-c2', 'mg-b', 'mg-b1', '2026-10-01'),
    ]);
    // The data steps only (the new fields exist already).
    const steps = statements(migration).filter((s) => !/^(ALTER|CREATE)/.test(s));
    await env.DB.batch(steps.map((s) => env.DB.prepare(s)));
    const cols = async (p: string) => (await call('GET', `/projects/${p}/full`)).columns;
    const a = await cols('mg-a');
    expect(a.map((c: any) => [c.name.trim(), c.is_done])).toEqual([['To do', false], ['Waiting', false], ['complete', true]]);
    expect(a[2].cards[0]).toMatchObject({ id: 'mg-c1', done: '2026-10-01' });
    const b = await cols('mg-b');
    expect(b.map((c: any) => [c.name, c.is_done])).toEqual([['Ideas', false], ['Done', true]]);
    expect(b[1].cards.map((c: any) => c.id)).toEqual(['mg-c2']);
    // Run again: nothing changes (one Done each).
    await env.DB.batch(steps.map((s) => env.DB.prepare(s)));
    expect((await cols('mg-b')).length).toBe(2);
  });
});
