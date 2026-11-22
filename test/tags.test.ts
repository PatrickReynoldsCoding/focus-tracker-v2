import { describe, expect, it } from 'vitest';
import { call, tool, toolError } from './helpers';

async function freshMode(id: string) {
  await call('POST', '/modes', { label: id, id });
  return { mode: id };
}
const names = (xs: { name: string }[]) => xs.map((x) => x.name).sort();

describe('tags', () => {
  it('has the tags flag on by default', async () => {
    const f = (await call('GET', '/features')).find((x: any) => x.id === 'tags');
    expect(f).toMatchObject({ enabled: true, label: 'Tags' });
  });

  it('makes, renames, recolours and deletes tags with unique names per profile', async () => {
    const m = await freshMode('tags-crud');
    const t = await call('POST', '/tags', { name: '  #Urgent  ', color: 'red' }, m);
    expect(t).toMatchObject({ name: 'Urgent', color: 'red' });
    await call('POST', '/tags', { name: 'urgent' }, { ...m, expect: 400 });
    await call('POST', '/tags', { name: 'a,b' }, { ...m, expect: 400 });
    await call('POST', '/tags', { name: 'None' }, { ...m, expect: 400 });
    await call('POST', '/tags', { name: 'x', color: 'hotpink' }, { ...m, expect: 400 });
    // Another profile may have the same name.
    const other = await freshMode('tags-crud-2');
    await call('POST', '/tags', { name: 'Urgent' }, other);

    const later = await call('POST', '/tags', { name: 'Later' }, m);
    await call('PATCH', `/tags/${later.id}`, { name: 'URGENT' }, { ...m, expect: 400 });
    expect(await call('PATCH', `/tags/${later.id}`, { name: 'Someday', color: null }, m)).toMatchObject({ name: 'Someday', color: null });
    await call('PATCH', `/tags/${later.id}`, { color: 'blue' }, m);
    const list = await call('GET', '/tags', undefined, m);
    expect(list.map((x: any) => [x.name, x.color, x.count])).toEqual([
      ['Someday', 'blue', 0],
      ['Urgent', 'red', 0],
    ]);
    await call('DELETE', `/tags/${later.id}`, undefined, m);
    expect(names(await call('GET', '/tags', undefined, m))).toEqual(['Urgent']);
    await call('POST', '/undo', {}, m);
    expect(names(await call('GET', '/tags', undefined, m))).toEqual(['Someday', 'Urgent']);
  });

  it('tags every kind of file, lists the tags with each file and filters and searches by them', async () => {
    const m = await freshMode('tags-files');
    const p = await call('POST', '/projects', { name: 'Kitchen' }, m);
    const note = await call('POST', '/lists', { name: 'Ideas', kind: 'note' }, m);
    const todo = await call('POST', '/lists', { name: 'Jobs', kind: 'todo' }, m);
    const board = await call('POST', '/whiteboards', { name: 'Plan' }, m);
    const link = await call('POST', '/resources', { title: 'Supplier', value: 'https://example.com/a', folder_id: null }, m);
    await call('POST', '/lists', { name: 'Loose', kind: 'note' }, m);

    // A new name makes a tag; the answer is the file's tags.
    const a = await call('POST', '/tags/set', { type: 'note', id: note.id, add: ['Home', 'Money'] }, m);
    expect(names(a.tags)).toEqual(['Home', 'Money']);
    await call('POST', '/tags/set', { type: 'todo', id: todo.id, add: ['home'] }, m);
    await call('POST', '/tags/set', { type: 'whiteboard', id: board.id, add: ['Money'] }, m);
    await call('POST', '/tags/set', { type: 'link', id: link.id, add: ['Home'] }, m);
    await call('POST', '/tags/set', { type: 'project-note', id: p.id, add: ['Home'] }, m);
    // The project's notes have their own tags (D53); the project itself has only its automatic tag.
    expect(names(await call('GET', `/tags/of/project-note/${p.id}`, undefined, m))).toEqual(['Home', 'Kitchen']);
    expect(names(await call('GET', `/tags/of/project/${p.id}`, undefined, m))).toEqual(['Kitchen']);
    await call('POST', '/tags/set', { type: 'note', id: 'nope-nope', add: ['Home'] }, { ...m, expect: 404 });
    await call('POST', '/tags/set', { type: 'folder', id: note.id, add: ['Home'] }, { ...m, expect: 400 });

    const tags = await call('GET', '/tags', undefined, m);
    expect(tags.map((t: any) => [t.name, t.count, !!t.auto])).toEqual([
      ['Home', 4, false],
      ['Money', 2, false],
      ['Kitchen', null, true],
    ]);
    const home = tags[0];

    // Each file carries its tags in the listing.
    const root = await call('GET', '/files', undefined, m);
    expect(names(root.files.find((f: any) => f.id === note.id).tags)).toEqual(['Home', 'Money']);
    expect(root.files.find((f: any) => f.name === 'Loose').tags).toEqual([]);

    // Filter: one tag, several (all of them), by id or name, and no tag.
    expect(names((await call('GET', `/files?tag=${home.id}`, undefined, m)).files)).toEqual(['Ideas', 'Jobs', 'Kitchen notes', 'Supplier']);
    expect(names((await call('GET', '/files?tag=home,MONEY', undefined, m)).files)).toEqual(['Ideas']);
    expect(names((await call('GET', '/files?tag=none', undefined, m)).files)).toEqual(['Loose']);
    expect((await call('GET', '/files?tag=nothing-like-it', undefined, m)).files).toEqual([]);
    // With a type too; inside a folder it looks in that folder only.
    expect(names((await call('GET', '/files?tag=Money&type=whiteboards', undefined, m)).files)).toEqual(['Plan']);
    const pf = (await call('GET', `/files?project=${p.id}`, undefined, m)).folder;
    expect(names((await call('GET', `/files?folder=${pf.id}&tag=Home`, undefined, m)).files)).toEqual(['Kitchen notes']);

    // Search finds a tag's name.
    expect(names((await call('GET', '/files?q=mone', undefined, m)).files)).toEqual(['Ideas', 'Plan']);
    expect((await call('GET', '/search?q=mone', undefined, m)).some((r: any) => r.kind === 'tags' && r.title === 'Money')).toBe(true);

    // Take one off, or set the whole set.
    expect(names((await call('POST', '/tags/set', { type: 'note', id: note.id, remove: ['money'] }, m)).tags)).toEqual(['Home']);
    expect(names((await call('POST', '/tags/set', { type: 'note', id: note.id, tags: ['Money', 'New one'] }, m)).tags)).toEqual(['Money', 'New one']);
    await call('POST', '/undo', {}, m);
    expect(names(await call('GET', `/tags/of/note/${note.id}`, undefined, m))).toEqual(['Home']);

    // Renaming a tag shows on every file.
    await call('PATCH', `/tags/${home.id}`, { name: 'House' }, m);
    expect(names((await call('GET', '/files?tag=House', undefined, m)).files)).toHaveLength(4);
  });

  it('removes a file’s tags with the file, and a tag from every file, and Undo brings them back', async () => {
    const m = await freshMode('tags-delete');
    const note = await call('POST', '/lists', { name: 'Ideas', kind: 'note' }, m);
    const board = await call('POST', '/whiteboards', { name: 'Plan' }, m);
    await call('POST', '/tags/set', { type: 'note', id: note.id, add: ['Home'] }, m);
    await call('POST', '/tags/set', { type: 'whiteboard', id: board.id, add: ['Home'] }, m);
    await call('DELETE', `/lists/${note.id}`, undefined, m);
    expect((await call('GET', '/tags', undefined, m))[0].count).toBe(1);
    await call('POST', '/undo', {}, m);
    expect((await call('GET', '/tags', undefined, m))[0].count).toBe(2);

    const tag = (await call('GET', '/tags', undefined, m))[0];
    await call('DELETE', `/tags/${tag.id}`, undefined, m);
    expect((await call('GET', `/tags/of/note/${note.id}`, undefined, m))).toEqual([]);
    await call('POST', '/undo', {}, m);
    expect(names(await call('GET', `/tags/of/whiteboard/${board.id}`, undefined, m))).toEqual(['Home']);

    // Deleting a project takes its tags (the project's notes are the project's).
    const p = await call('POST', '/projects', { name: 'Shed' }, m);
    await call('POST', '/tags/set', { type: 'project', id: p.id, add: ['Home'] }, m);
    await call('DELETE', `/projects/${p.id}`, undefined, m);
    expect((await call('GET', '/tags', undefined, m))[0].count).toBe(2);
  });

  it('merges tags', async () => {
    const m = await freshMode('tags-merge');
    const a = await call('POST', '/lists', { name: 'A', kind: 'note' }, m);
    const b = await call('POST', '/lists', { name: 'B', kind: 'note' }, m);
    await call('POST', '/tags/set', { type: 'note', id: a.id, add: ['Work', 'Job'] }, m);
    await call('POST', '/tags/set', { type: 'note', id: b.id, add: ['Job'] }, m);
    const [job, work] = await call('GET', '/tags', undefined, m);
    const r = await call('POST', `/tags/${job.id}/merge`, { into: work.id }, m);
    expect(r.into).toMatchObject({ name: 'Work', count: 2 });
    expect(names(await call('GET', '/tags', undefined, m))).toEqual(['Work']);
    await call('POST', `/tags/${work.id}/merge`, { into: work.id }, { ...m, expect: 400 });
    await call('POST', '/undo', {}, m);
    expect(names(await call('GET', '/tags', undefined, m))).toEqual(['Job', 'Work']);
  });

  it('gives Claude tag tools, and list_files filters by tags', async () => {
    const m = await freshMode('tags-claude');
    const note = await call('POST', '/lists', { name: 'Ideas', kind: 'note' }, m);
    await call('POST', '/lists', { name: 'Other', kind: 'note' }, m);
    const made = await tool('create_tag', { mode: m.mode, name: 'Reading', color: 'green' });
    expect(made).toMatchObject({ name: 'Reading', color: 'green' });
    expect(await toolError('create_tag', { mode: m.mode, name: 'reading' })).toMatch(/already/);
    expect(names((await tool('tag_file', { mode: m.mode, type: 'note', id: note.id, tags: ['Reading', 'Books'] })).tags)).toEqual(['Books', 'Reading']);
    expect(names((await tool('list_files', { mode: m.mode, tags: ['books'] })).files)).toEqual(['Ideas']);
    expect(names((await tool('list_files', { mode: m.mode, untagged: true })).files)).toEqual(['Other']);
    expect(names((await tool('untag_file', { mode: m.mode, type: 'note', id: note.id, tags: ['Books'] })).tags)).toEqual(['Reading']);
    await tool('update_tag', { mode: m.mode, id: made.id, name: 'To read', color: null });
    const listed = await tool('list_tags', { mode: m.mode });
    expect(listed.map((t: any) => [t.name, t.color, t.count])).toEqual([
      ['Books', null, 0],
      ['To read', null, 1],
    ]);
    await tool('merge_tags', { mode: m.mode, id: listed[0].id, into: made.id });
    await tool('delete_tag', { mode: m.mode, id: made.id });
    expect(await tool('list_tags', { mode: m.mode })).toEqual([]);
    await tool('undo', { mode: m.mode });
    expect(names(await tool('list_tags', { mode: m.mode }))).toEqual(['To read']);
  });

  it('hides tags while the flag is off', async () => {
    const m = await freshMode('tags-off');
    const note = await call('POST', '/lists', { name: 'Ideas', kind: 'note' }, m);
    await call('POST', '/tags/set', { type: 'note', id: note.id, add: ['Home'] }, m);
    await call('PUT', '/features/tags', { enabled: false }, m);
    await call('GET', '/tags', undefined, { ...m, expect: 404 });
    const root = await call('GET', '/files?tag=Home', undefined, m);
    expect(root.files[0].tags).toBeUndefined();
    expect(names(root.files)).toEqual(['Ideas']);
    await call('PUT', '/features/tags', { enabled: true }, m);
  });
});
