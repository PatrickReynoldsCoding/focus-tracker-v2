// To-dos are boards (D40): migration 0022 turns the old todos table into cards with a Done column;
// the old to-do API (REST /todos, add_todo, tick_todo, the todos kind, the to-do shape in lists,
// Today, status, plan, links, search, profile counts) answers as before; a list becomes a to-do
// (one way); the done and day rules on a to-do's board.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { statements } from '../src/core/migrate';
import { call, tool, toolError } from './helpers';
import migration from '../migrations/0022_unified_todos.sql';

let n = 0;
async function fresh() {
  const m = await call('POST', '/modes', { label: `Todo ${++n} ${Math.random().toString(36).slice(2, 6)}` });
  return { mode: m.id as string };
}
const TODO_KEYS = ['id', 'mode', 'title', 'list_id', 'group_id', 'day', 'done', 'project_id', 'note', 'color', 'created', 'updated_at', 'ord'];

describe('migration 0022', () => {
  it('turns to-dos into cards with a Done column, keeping ids, groups, days, done days, order and links', async () => {
    const T = '2026-10-01T09:00:00.000Z';
    const M = 'personal';
    // The todos table as it was before 0022 (0001_init.sql).
    await env.DB.prepare(
      `CREATE TABLE todos (id TEXT PRIMARY KEY, mode TEXT NOT NULL, list_id TEXT NOT NULL, group_id TEXT, title TEXT NOT NULL, day TEXT, done TEXT,
        project_id TEXT, note TEXT, color TEXT, ord REAL NOT NULL DEFAULT 0, created TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    ).run();
    const todo = (id: string, list: string, group: string | null, ord: number, day: string | null, done: string | null, project: string | null = null) =>
      env.DB.prepare('INSERT INTO todos (id, mode, list_id, group_id, title, day, done, project_id, note, color, ord, created, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(
        id, M, list, group, `T ${id}`, day, done, project, `note ${id}`, id === 'mt-1' ? 'red' : null, ord, T, `2026-10-0${ord}T09:00:00.000Z`,
      );
    await env.DB.batch([
      env.DB.prepare("INSERT INTO projects (id, mode, name, status, ord, created, updated_at) VALUES ('mt-p', ?, 'P', 'active', 1, ?, ?)").bind(M, T, T),
      env.DB.prepare(
        "INSERT INTO lists (id, mode, name, kind, show_today, folder_id, ord, created, updated_at) VALUES ('mt-l1', ?, 'Errands', 'todo', 1, NULL, 1, ?, ?), ('mt-l2', ?, 'Bare', 'todo', 0, NULL, 2, ?, ?)",
      ).bind(M, T, T, M, T, T),
      env.DB.prepare("INSERT INTO columns (id, mode, list_id, name, ord, created, updated_at) VALUES ('mt-g1', ?, 'mt-l1', 'General', 1, ?, ?), ('mt-g2', ?, 'mt-l1', 'Shops', 2, ?, ?)").bind(
        M, T, T, M, T, T,
      ),
      todo('mt-1', 'mt-l1', 'mt-g1', 1, '2026-10-02', null, 'mt-p'),
      todo('mt-2', 'mt-l1', 'mt-g1', 2, null, '2026-10-03'),
      todo('mt-3', 'mt-l1', 'mt-g1', 3, null, null),
      todo('mt-4', 'mt-l1', 'mt-g2', 4, '2026-10-05', '2026-10-05'),
      todo('mt-5', 'mt-l1', null, 5, null, null),
      todo('mt-6', 'mt-l2', null, 6, null, null),
      env.DB.prepare("INSERT INTO links (id, mode, from_kind, from_id, type, to_kind, to_id, created, updated_at) VALUES ('mt-k', ?, 'todos', 'mt-3', 'blocks', 'projects', 'mt-p', ?, ?)").bind(M, T, T),
      env.DB.prepare("INSERT INTO undo (mode, batch, label, entity, row_id, before, after, created) VALUES (?, 'b1', 'x', 'todos', 'mt-1', NULL, '{}', ?)").bind(M, T),
    ]);
    const steps = statements(migration).filter((s) => !/^(ALTER|CREATE)/.test(s));
    await env.DB.batch(steps.map((s) => env.DB.prepare(s)));

    expect(await env.DB.prepare("SELECT name FROM sqlite_master WHERE name = 'todos'").first()).toBeNull();
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM undo').first<{ n: number }>())!.n).toBe(0);
    // The board: groups, then Done last; done to-dos in Done, remembering their group.
    const board = await call('GET', '/boards/list/mt-l1');
    expect(board.map((c: any) => [c.name, c.is_done])).toEqual([['General', false], ['Shops', false], ['Done', true]]);
    expect(board[0].cards.map((c: any) => c.id)).toEqual(['mt-1', 'mt-3', 'mt-5']);
    expect(board[2].cards.map((c: any) => [c.id, c.done, c.from_column_id])).toEqual([['mt-2', '2026-10-03', 'mt-g1'], ['mt-4', '2026-10-05', 'mt-g2']]);
    expect(board[0].cards[0]).toMatchObject({ title: 'T mt-1', note: 'note mt-1', color: 'red', day: '2026-10-02', about_project_id: 'mt-p', created: T, updated_at: '2026-10-01T09:00:00.000Z', ord: 1 });
    // The old shape, as before: every to-do in its group, in its order, with its done day.
    const full = await call('GET', '/lists/mt-l1/full');
    expect(full.groups.map((g: any) => [g.id, g.todos.map((t: any) => [t.id, t.done])])).toEqual([
      ['mt-g1', [['mt-1', null], ['mt-2', '2026-10-03'], ['mt-3', null], ['mt-5', null]]],
      ['mt-g2', [['mt-4', '2026-10-05']]],
    ]);
    const t1 = await call('GET', '/todos/mt-1');
    expect(Object.keys(t1)).toEqual(TODO_KEYS);
    expect(t1).toMatchObject({ list_id: 'mt-l1', group_id: 'mt-g1', day: '2026-10-02', done: null, project_id: 'mt-p', ord: 1 });
    // A list with no group got General; the link to a to-do still reads it.
    expect((await call('GET', '/boards/list/mt-l2')).map((c: any) => [c.name, c.cards.length])).toEqual([['General', 1], ['Done', 0]]);
    expect((await call('GET', '/projects/mt-p/full')).blocked_by.map((b: any) => [b.kind, b.id])).toEqual([['todos', 'mt-3']]);
    expect((await call('GET', '/lists/mt-l1')).show_today).toBe(true);
  });
});

describe('the old to-do API over cards', () => {
  it('creates, changes, ticks, moves and deletes to-dos in the old shape', async () => {
    const m = await fresh();
    const { day } = await call('GET', '/today', undefined, m);
    const t = await call('POST', '/todos', { title: 'Milk', day }, m);
    expect(Object.keys(t)).toEqual(TODO_KEYS);
    const l = await call('GET', `/lists/${t.list_id}/full`, undefined, m);
    expect(l).toMatchObject({ kind: 'todo', name: 'To-dos' });
    expect(l.groups.map((g: any) => g.name)).toEqual(['General']);
    const [general, done] = await call('GET', `/boards/list/${l.id}`, undefined, m);
    expect(done).toMatchObject({ name: 'Done', is_done: true });
    expect(t.group_id).toBe(general.id);
    const shops = await call('POST', '/columns', { list_id: l.id, name: 'Shops' }, m);
    // A new group goes before Done.
    expect((await call('GET', `/boards/list/${l.id}`, undefined, m)).map((c: any) => c.name)).toEqual(['General', 'Shops', 'Done']);
    const eggs = await call('POST', '/todos', { title: 'Eggs', list_id: l.id, group_id: shops.id }, m);
    const tea = await call('POST', '/todos', { title: 'Tea', list_id: l.id, group_id: shops.id }, m);

    // Tick: the card goes into Done; the to-do still says its group, in its place.
    let x = await call('POST', `/todos/${eggs.id}/tick`, { done: true }, m);
    expect(x).toMatchObject({ done: day, group_id: shops.id, ord: eggs.ord });
    expect((await call('GET', `/tasks/${eggs.id}`, undefined, m)).column_id).toBe(done.id);
    let g = (await call('GET', `/lists/${l.id}/full`, undefined, m)).groups;
    expect(g[1].todos.map((y: any) => [y.title, !!y.done])).toEqual([['Eggs', true], ['Tea', false]]);
    // Untick: back to its group, same place.
    x = await call('POST', `/todos/${eggs.id}/tick`, { done: false }, m);
    expect(x).toMatchObject({ done: null, group_id: shops.id });
    expect((await call('GET', `/tasks/${eggs.id}`, undefined, m)).column_id).toBe(shops.id);
    g = (await call('GET', `/lists/${l.id}/full`, undefined, m)).groups;
    expect(g[1].todos.map((y: any) => y.title)).toEqual(['Eggs', 'Tea']);
    // PATCH done, day, group (a done to-do changes group but stays done), project.
    x = await call('PATCH', `/todos/${tea.id}`, { done: day }, m);
    expect(x.done).toBe(day);
    x = await call('PATCH', `/todos/${tea.id}`, { group_id: general.id, day: '2026-12-01' }, m);
    expect(x).toMatchObject({ done: day, group_id: general.id, day: '2026-12-01' });
    const p = await call('POST', '/projects', { name: 'Kitchen' }, m);
    x = await call('PATCH', `/todos/${tea.id}`, { done: null, project_id: p.id }, m);
    expect(x).toMatchObject({ done: null, group_id: general.id, project_id: p.id });
    expect((await call('GET', `/tasks/${tea.id}`, undefined, m)).column_id).toBe(general.id);
    // The project's board does not show it.
    expect((await call('GET', `/projects/${p.id}/full`, undefined, m)).columns.flatMap((c: any) => c.cards)).toEqual([]);
    // Move within a group and to another; filters; delete.
    x = await call('POST', `/todos/${tea.id}/move`, { group_id: general.id, index: 0 }, m);
    expect((await call('GET', `/todos?group_id=${general.id}`, undefined, m)).map((y: any) => y.title)).toEqual(['Tea', 'Milk']);
    expect((await call('GET', `/todos?list_id=${l.id}&day=${day}`, undefined, m)).map((y: any) => y.title)).toEqual(['Milk']);
    await call('DELETE', `/todos/${tea.id}`, undefined, m);
    await call('GET', `/todos/${tea.id}`, undefined, { ...m, expect: 404 });
    // Not a to-do list; not a field; not a to-do.
    const plain = await call('POST', '/lists', { name: 'Plain' }, m);
    await call('POST', '/todos', { title: 'x', list_id: plain.id }, { ...m, expect: 400 });
    await call('POST', '/todos', { title: 'x', colour: 'red' }, { ...m, expect: 400 });
    await call('POST', '/todos', { title: 'x', group_id: done.id }, { ...m, expect: 400 });
    const card = await call('POST', '/tasks', { title: 'Book', list_id: plain.id }, m);
    await call('GET', `/todos/${card.id}`, undefined, { ...m, expect: 404 });
    await call('POST', `/todos/${card.id}/tick`, { done: true }, { ...m, expect: 404 });
    // Undo takes a tick back.
    await call('POST', `/todos/${eggs.id}/tick`, { done: true }, m);
    await call('POST', '/undo', undefined, m);
    expect(await call('GET', `/todos/${eggs.id}`, undefined, m)).toMatchObject({ done: null, group_id: shops.id });
  });

  it('keeps Claude’s to-do tools and the todos kind', async () => {
    const m = await fresh();
    const l = await tool('create_list', { name: 'Jobs', kind: 'todo', items: ['Paint', 'Sand'], mode: m.mode });
    expect(l.groups[0].todos.map((t: any) => t.title)).toEqual(['Paint', 'Sand']);
    const t = await tool('add_todo', { title: 'Glue', list_id: l.id, mode: m.mode });
    expect(Object.keys(t)).toEqual(TODO_KEYS);
    expect((await tool('tick_todo', { id: t.id, mode: m.mode })).done).not.toBeNull();
    expect((await tool('get_list', { id: l.id, mode: m.mode })).groups[0].todos.map((x: any) => [x.title, !!x.done])).toEqual([['Paint', false], ['Sand', false], ['Glue', true]]);
    const item = await tool('create_item', { kind: 'todos', fields: { title: 'Wax', list_id: l.id }, mode: m.mode });
    expect(item.group_id).toBe(l.groups[0].id);
    expect((await tool('update_item', { kind: 'todos', id: item.id, fields: { day: '2026-12-24' }, mode: m.mode })).day).toBe('2026-12-24');
    expect((await tool('list_items', { kind: 'todos', filters: { list_id: l.id }, mode: m.mode })).length).toBe(4);
    expect((await tool('get_item', { kind: 'todos', id: item.id, mode: m.mode })).title).toBe('Wax');
    await tool('delete_item', { kind: 'todos', id: item.id, mode: m.mode });
    expect((await tool('describe_kinds', {})).some((k: any) => k.kind === 'todos')).toBe(true);
    const s = await tool('schedule_todo', { id: t.id, day: null, mode: m.mode });
    expect(Object.keys(s)).toEqual(TODO_KEYS);
    // get_board shows the to-do's board, Done last.
    const b = await tool('get_board', { list_id: l.id, mode: m.mode });
    expect(b.map((c: any) => [c.name, c.cards.map((x: any) => x.title)])).toEqual([['General', ['Paint', 'Sand']], ['Done', ['Glue']]]);
    // add_card and move_card on a to-do: into Done = done.
    const c = await tool('add_card', { list_id: l.id, column: 'done', title: 'Prime', mode: m.mode });
    expect(c.done).not.toBeNull();
    expect((await tool('move_card', { id: c.id, column: 'General', mode: m.mode })).done).toBeNull();
    expect((await tool('update_card', { id: c.id, done: true, mode: m.mode })).column_id).toBe(b[1].id);
  });

  it('gives Today, status, plan, search, links and profile counts the same answers', async () => {
    const m = await fresh();
    const { day } = await call('GET', '/today', undefined, m);
    const t = await call('POST', '/todos', { title: 'Ring the vet', day }, m);
    const other = await call('POST', '/lists', { name: 'Garden', kind: 'todo' }, m);
    const t2 = await call('POST', '/todos', { title: 'Mow', list_id: other.id, day }, m);
    const today = await call('GET', '/today', undefined, m);
    expect(today.todos.map((x: any) => x.title)).toEqual(['Ring the vet', 'Mow']);
    expect(Object.keys(today.todos[0])).toEqual(TODO_KEYS);
    expect(today.cards).toEqual([]);
    expect(today.todo_lists).toEqual({ [other.id]: 'Garden' });
    const list = await call('GET', '/today/list', undefined, m);
    expect(list.items.map((x: any) => [x.kind, x.title])).toEqual([['todo', 'Ring the vet'], ['todo', 'Mow']]);
    await call('POST', `/todos/${t2.id}/tick`, { done: true }, m);
    const status = await call('GET', '/status', undefined, m);
    expect(status.todos_due).toEqual([{ id: t.id, title: 'Ring the vet', day }]);
    expect(status.today_list).toMatchObject({ left: 1, done: 1 });
    // The Notes tab card and the Files tab count open to-dos.
    const ov = (await call('GET', '/lists/overview', undefined, m)).find((x: any) => x.id === other.id);
    expect(ov).toMatchObject({ open: 0, done_today: 1 });
    const files = await call('GET', '/files?type=todo', undefined, m);
    expect(files.files.find((f: any) => f.id === other.id)).toMatchObject({ type: 'todo', count: 0 });
    // Search finds a to-do as a to-do, not as a card.
    expect((await call('GET', '/search?q=vet', undefined, m)).map((r: any) => [r.kind, r.id])).toEqual([['todos', t.id]]);
    // Links: a to-do is linked as a to-do, whichever kind is given; deleting it removes its links.
    const p = await call('POST', '/projects', { name: 'Pets' }, m);
    const link = await call('POST', '/links', { from_kind: 'tasks', from_id: t.id, type: 'blocks', to_kind: 'projects', to_id: p.id }, m);
    expect(link.from_kind).toBe('todos');
    expect((await call('GET', `/projects/${p.id}/full`, undefined, m)).blocked_by.map((b: any) => b.title)).toEqual(['Ring the vet']);
    await call('POST', `/todos/${t.id}/tick`, { done: true }, m);
    expect((await call('GET', `/projects/${p.id}/full`, undefined, m)).blocked_by).toEqual([]);
    await call('DELETE', `/todos/${t.id}`, undefined, m);
    expect(await call('GET', `/links?from_id=${t.id}`, undefined, m)).toEqual([]);
    // A profile's usage counts to-dos and cards apart, as before.
    await call('POST', '/tasks', { title: 'Card', project_id: p.id }, m);
    const usage = await call('GET', `/profiles/${m.mode}/usage`, undefined, m);
    const by = Object.fromEntries(usage.map((u: any) => [u.kind, u.count]));
    expect([by.todos, by.tasks]).toEqual([1, 1]);
  });
});

describe('a list becomes a to-do', () => {
  it('converts one way, keeping its id, items, folder and place on Today', async () => {
    const m = await fresh();
    const { day } = await call('GET', '/today', undefined, m);
    const folder = await call('POST', '/folders', { name: 'Home' }, m);
    const l = await call('POST', '/lists', { name: 'Books', kind: 'list', folder_id: folder.id, show_today: true }, m);
    const [items] = await call('GET', `/boards/list/${l.id}`, undefined, m);
    const a = await call('POST', '/tasks', { title: 'Dune', list_id: l.id, day }, m);
    const b = await call('POST', '/tasks', { title: 'Emma', list_id: l.id }, m);
    await call('POST', `/tasks/${b.id}/tick`, { done: true }, m); // a plain list's item only records the day
    expect((await call('GET', `/tasks/${b.id}`, undefined, m)).column_id).toBe(items.id);
    const p = await call('POST', '/projects', { name: 'Reading' }, m);
    const link = await call('POST', '/links', { from_kind: 'tasks', from_id: a.id, type: 'relates', to_kind: 'projects', to_id: p.id }, m);
    expect(link.from_kind).toBe('tasks');
    // The Today list showed the item as a card.
    expect((await call('GET', '/today/list', undefined, m)).items.map((x: any) => [x.kind, x.title])).toEqual([['card', 'Dune']]);
    // A list cannot change kind by hand.
    await call('PATCH', `/lists/${l.id}`, { kind: 'todo' }, { ...m, expect: 400 });

    const t = await call('POST', `/lists/${l.id}/convert`, {}, m);
    expect(t).toMatchObject({ id: l.id, kind: 'todo', folder_id: folder.id, show_today: true });
    expect(t.groups.map((g: any) => [g.id, g.name, g.todos.map((x: any) => [x.id, x.done])])).toEqual([[items.id, 'Items', [[a.id, null], [b.id, day]]]]);
    const board = await call('GET', `/boards/list/${l.id}`, undefined, m);
    expect(board.map((c: any) => [c.name, c.is_done, c.cards.map((x: any) => x.id)])).toEqual([['Items', false, [a.id]], ['Done', true, [b.id]]]);
    // Its items are to-dos now: in the Today list, in the Files tab as a to-do, links as to-dos.
    expect((await call('GET', '/today/list', undefined, m)).items.map((x: any) => [x.kind, x.title, x.state])).toEqual([['todo', 'Dune', 'open'], ['todo', 'Emma', 'done']]);
    expect((await call('GET', `/links?from_id=${a.id}`, undefined, m)).map((k: any) => [k.id, k.from_kind])).toEqual([[link.id, 'todos']]);
    expect((await call('GET', `/files?folder=${folder.id}`, undefined, m)).files.map((f: any) => [f.id, f.type])).toEqual([[l.id, 'todo']]);
    // Again: nothing changes. Never back, never a note.
    expect((await tool('convert_list_to_todo', { id: l.id, mode: m.mode })).groups.length).toBe(1);
    await call('PATCH', `/lists/${l.id}`, { kind: 'list' }, { ...m, expect: 400 });
    const note = await call('POST', '/lists', { name: 'Thoughts', kind: 'note' }, m);
    expect(await toolError('convert_list_to_todo', { id: note.id, mode: m.mode })).toContain('note');
    // Undo takes the whole conversion back.
    const l2 = await call('POST', '/lists', { name: 'Films', kind: 'list' }, m);
    await call('POST', `/lists/${l2.id}/convert`, {}, m);
    await call('POST', '/undo', undefined, m);
    expect((await call('GET', `/lists/${l2.id}`, undefined, m)).kind).toBe('list');
    expect((await call('GET', `/boards/list/${l2.id}`, undefined, m)).map((c: any) => c.name)).toEqual(['Items']);
  });
});

describe('done and day rules on a to-do', () => {
  it('keeps one fixed Done column; a day never changes status; plain lists have no Done', async () => {
    const m = await fresh();
    const { day } = await call('GET', '/today', undefined, m);
    const l = await call('POST', '/lists', { name: 'Jobs', kind: 'todo' }, m);
    const [general, done] = await call('GET', `/boards/list/${l.id}`, undefined, m);
    await call('DELETE', `/columns/${done.id}`, undefined, { ...m, expect: 400 });
    await call('POST', '/columns', { list_id: l.id, name: 'Done 2', is_done: true }, { ...m, expect: 400 });
    await call('PATCH', `/columns/${done.id}`, { name: 'Finished' }, m);
    // Drag into Done: done; out: not done.
    const c = await call('POST', '/tasks', { title: 'Fix tap', list_id: l.id }, m);
    let x = await call('POST', `/tasks/${c.id}/move`, { column_id: done.id }, m);
    expect([x.done, x.from_column_id]).toEqual([day, general.id]);
    // A day on a done to-do keeps it done (set_card_day), as on a project.
    x = await tool('set_card_day', { id: c.id, day, mode: m.mode });
    expect([x.done, x.column_id]).toEqual([day, done.id]);
    x = await call('POST', `/tasks/${c.id}/move`, { column_id: general.id }, m);
    expect([x.done, x.from_column_id]).toEqual([null, null]);
    // Ticked from the Today list (as a to-do), it goes into Done.
    await call('PATCH', `/tasks/${c.id}`, { day }, m);
    await tool('tick_today_item', { kind: 'todo', id: c.id, mode: m.mode });
    expect((await call('GET', `/tasks/${c.id}`, undefined, m)).column_id).toBe(done.id);
    // A group that was deleted: unticking goes to the first group.
    const extra = await call('POST', '/columns', { list_id: l.id, name: 'Later' }, m);
    const d = await call('POST', '/todos', { title: 'Oil hinge', list_id: l.id, group_id: extra.id, done: day }, m);
    expect(d).toMatchObject({ group_id: extra.id, done: day });
    await call('DELETE', `/columns/${extra.id}`, undefined, m);
    // (deleting a group deletes its open cards, as before; a done one stays in Done)
    expect((await call('POST', `/todos/${d.id}/tick`, { done: false }, m)).group_id).toBe(general.id);
    // Deleting the to-do takes its Done column too.
    await call('DELETE', `/lists/${l.id}`, undefined, m);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM columns WHERE list_id = ?').bind(l.id).first('n')).toBe(0);
    // A plain list has no Done column.
    const plain = await call('POST', '/lists', { name: 'Ideas', kind: 'list' }, m);
    await call('POST', '/columns', { list_id: plain.id, name: 'Done', is_done: true }, { ...m, expect: 400 });
  });
});

describe('importing old to-dos', () => {
  it('takes rows of the todos kind, giving a list made without columns its Done column', async () => {
    const m = await fresh();
    const T = '2026-09-01T09:00:00.000Z';
    await call('POST', '/import/lists', { rows: [{ id: 'imp-l1', name: 'Old', kind: 'todo', created: T }] }, m);
    await call('POST', '/import/columns', { rows: [{ id: 'imp-g1', list_id: 'imp-l1', name: 'General', created: T }] }, m);
    const r = await call('POST', '/import/todos', { rows: [{ id: 'imp-t1', list_id: 'imp-l1', group_id: 'imp-g1', title: 'Done long ago', done: '2026-09-02', created: T }, { id: 'imp-t2', list_id: 'imp-l1', group_id: 'imp-g1', title: 'Open', created: T }] }, m);
    expect(r).toMatchObject({ created: 2, skipped: 0, errors: [] });
    expect(await call('GET', '/todos/imp-t1', undefined, m)).toMatchObject({ group_id: 'imp-g1', done: '2026-09-02', created: T });
    expect((await call('GET', '/boards/list/imp-l1', undefined, m)).map((c: any) => [c.name, c.cards.map((x: any) => x.id)])).toEqual([['General', ['imp-t2']], ['Done', ['imp-t1']]]);
    // Run again: skipped.
    expect((await call('POST', '/import/todos', { rows: [{ id: 'imp-t2', list_id: 'imp-l1', title: 'Open' }] }, m)).skipped).toBe(1);
  });
});
