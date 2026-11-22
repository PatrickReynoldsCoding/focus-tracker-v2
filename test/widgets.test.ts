import { describe, expect, it } from 'vitest';
import { cut, plainText } from '../src/modules/widgets';
import { call } from './helpers';

async function freshMode(id: string) {
  await call('POST', '/modes', { label: id, id });
  return { mode: id };
}
const titles = (xs: { title: string }[]) => xs.map((x) => x.title);

describe('widget feeds', () => {
  it('turns Markdown into short plain text', () => {
    expect(plainText('# Shop\n\n- [ ] **Milk**\n- [x] Eggs\n* [Site](https://x.y) and `code`\n> quote')).toBe('Shop\n\n☐ Milk\n☑ Eggs\n• Site and code\nquote');
    expect(cut('one two three four', 12, null)).toEqual({ text: 'one two…', cut: true });
    expect(cut('a\nb\nc', 100, 2)).toEqual({ text: 'a\nb…', cut: true });
    expect(cut('short', 100, 3)).toEqual({ text: 'short', cut: false });
  });

  it('lists a folder, a tag or everything, each file cut to the length asked for', async () => {
    const m = await freshMode('widget-files');
    const shelf = await call('POST', '/folders', { name: 'Shelf' }, m);
    const inner = await call('POST', '/folders', { name: 'Inner', parent_id: shelf.id }, m);
    const note = await call('POST', '/lists', { name: 'Ideas', kind: 'note', folder_id: shelf.id }, m);
    await call('PUT', `/notes/of/list/${note.id}`, { body: '# Ideas\n\nA **long** first line that goes on and on\nsecond\nthird' }, m);
    const todo = await call('POST', '/lists', { name: 'Jobs', kind: 'todo', folder_id: inner.id }, m);
    const a = await call('POST', '/todos', { title: 'Paint', list_id: todo.id }, m);
    await call('POST', '/todos', { title: 'Sand', list_id: todo.id }, m);
    await call('POST', '/todos', { title: 'Glue', list_id: todo.id }, m);
    await call('POST', `/todos/${a.id}/tick`, { done: true }, m);
    const list = await call('POST', '/lists', { name: 'Books', kind: 'list' }, m);
    await call('POST', '/tasks', { title: 'Dune', list_id: list.id }, m);
    const board = await call('POST', '/whiteboards', { name: 'Map', folder_id: shelf.id }, m);
    const p = await call('POST', '/projects', { name: 'Kitchen' }, m);
    await call('PUT', `/notes/of/project/${p.id}`, { body: 'Tiles: white' }, m);
    await call('POST', '/tags/set', { type: 'note', id: note.id, add: ['Home'] }, m);
    await call('POST', '/tags/set', { type: 'whiteboard', id: board.id, add: ['Home'] }, m);
    await call('POST', '/tags/set', { type: 'project-note', id: p.id, add: ['home'] }, m);

    // A folder and the folders inside it; whiteboards only with kinds=others.
    let r = await call('GET', `/widget/files?folder=${shelf.id}&max=30&sort=name`, undefined, m);
    expect(r.source).toMatchObject({ by: 'folder', id: shelf.id, name: 'Shelf' });
    expect(titles(r.files)).toEqual(['Ideas', 'Jobs']);
    const [n, t] = r.files;
    expect(n).toMatchObject({ kind: 'note', route: `/n/${note.id}`, more: true });
    expect(n.text).toBe('Ideas\n\nA long first line that…');
    expect(t).toMatchObject({ kind: 'todo', open: 2, text: '☐ Sand\n☐ Glue', more: false });
    expect(t.items.map((i: any) => [i.title, i.done])).toEqual([['Sand', false], ['Glue', false]]);

    // Not the folders inside; lines instead of characters; others too.
    r = await call('GET', `/widget/files?folder=${shelf.id}&deep=0&lines=1&kinds=note,others`, undefined, m);
    expect(titles(r.files).sort()).toEqual(['Ideas', 'Map']);
    expect(r.files.find((f: any) => f.kind === 'note').text).toBe('Ideas…');
    expect(r.files.find((f: any) => f.kind === 'whiteboard')).toMatchObject({ route: `/w/${board.id}`, text: '' });

    // The top level, a tag (by name, any case, with a project's notes), everything.
    r = await call('GET', '/widget/files?folder=root', undefined, m);
    expect(titles(r.files)).toEqual(['Books']);
    expect(r.files[0]).toMatchObject({ kind: 'list', text: '• Dune', open: 1 });
    r = await call('GET', '/widget/files?tag=HOME&kinds=default,others&sort=name', undefined, m);
    expect(r.source).toMatchObject({ by: 'tag', name: 'Home' });
    expect(titles(r.files)).toEqual(['Ideas', 'Kitchen notes', 'Map']);
    expect(r.files[1]).toMatchObject({ kind: 'project-note', route: `/pn/${p.id}`, text: 'Tiles: white', project: 'Kitchen' });
    r = await call('GET', '/widget/files?limit=2', undefined, m);
    expect(r.files.length).toBe(2);
    expect(r.more).toBe(true);

    // Newest change first: an item added to the list makes it the newest.
    await call('POST', '/tasks', { title: 'Emma', list_id: list.id }, m);
    r = await call('GET', '/widget/files', undefined, m);
    expect(r.files[0].title).toBe('Books');

    // A folder or tag that is gone, or in another profile.
    r = await call('GET', '/widget/files?folder=nope', undefined, m);
    expect(r).toMatchObject({ missing: true, files: [] });
    r = await call('GET', `/widget/files?folder=${shelf.id}`, undefined, await freshMode('widget-files-2'));
    expect(r).toMatchObject({ missing: true, files: [] });
    await call('GET', `/widget/files?folder=${shelf.id}&tag=Home`, undefined, { ...m, expect: 400 });
    await call('GET', '/widget/files?kinds=pictures', undefined, { ...m, expect: 400 });
  });

  it('caps what it sends, whatever is asked for', async () => {
    const m = await freshMode('widget-caps');
    const note = await call('POST', '/lists', { name: 'Long', kind: 'note' }, m);
    await call('PUT', `/notes/of/list/${note.id}`, { body: 'word '.repeat(2000) }, m);
    const r = await call('GET', '/widget/files?max=99999&limit=999', undefined, m);
    expect(r.files[0].text.length).toBeLessThanOrEqual(1001);
    expect(r.files[0].more).toBe(true);
    const one = await call('GET', `/widget/file/note/${note.id}?max=99999`, undefined, m);
    expect(one.file.text.length).toBeLessThanOrEqual(4001);
  });

  it('gives one file, with a to-do’s done items after the open ones', async () => {
    const m = await freshMode('widget-one');
    const todo = await call('POST', '/lists', { name: 'Shop', kind: 'todo' }, m);
    const milk = await call('POST', '/todos', { title: 'Milk', list_id: todo.id }, m);
    await call('POST', '/todos', { title: 'Tea', list_id: todo.id }, m);
    await call('POST', `/todos/${milk.id}/tick`, { done: true }, m);
    let r = await call('GET', `/widget/file/todo/${todo.id}`, undefined, m);
    expect(r.file).toMatchObject({ kind: 'todo', title: 'Shop', open: 1, text: '☐ Tea\n☑ Milk', more: false });
    expect(r.file.items.map((i: any) => [i.id, i.done])).toEqual([
      [expect.any(String), false],
      [milk.id, true],
    ]);
    r = await call('GET', `/widget/file/list/${todo.id}?done=0`, undefined, m);
    expect(r.file.text).toBe('☐ Tea');
    r = await call('GET', `/widget/file/todo/${todo.id}?lines=1`, undefined, m);
    expect(r.file).toMatchObject({ text: '☐ Tea', more: true });

    const link = await call('POST', '/resources', { title: 'Supplier', value: 'https://example.com/a', folder_id: null }, m);
    r = await call('GET', `/widget/file/link/${link.id}`, undefined, m);
    expect(r.file).toMatchObject({ kind: 'link', route: null, url: 'https://example.com/a' });
    const p = await call('POST', '/projects', { name: 'Shed' }, m);
    r = await call('GET', `/widget/file/project-note/${p.id}`, undefined, m);
    expect(r.file).toMatchObject({ title: 'Shed notes', text: '' });

    await call('GET', `/widget/file/todo/${todo.id}`, undefined, { mode: 'personal', expect: 404 });
    await call('GET', '/widget/file/note/nope', undefined, { ...m, expect: 404 });
    await call('GET', `/widget/file/song/${todo.id}`, undefined, { ...m, expect: 400 });
  });
});
