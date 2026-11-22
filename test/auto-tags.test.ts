// A project's automatic tag (D53): every file of a project carries a read-only tag with the
// project's name (id project:<project id>), worked out when read; it follows renames and deletion,
// shows in GET /api/tags, the Files filter and search, the widgets and Claude's list_files.
import { describe, expect, it } from 'vitest';
import { call, tool, toolError } from './helpers';

async function freshMode(id: string) {
  await call('POST', '/modes', { label: id, id });
  return { mode: id };
}
const names = (xs: { name: string }[]) => xs.map((x) => x.name).sort();

describe('automatic project tags', () => {
  it('puts the project’s name on every file of the project, read only, following the project', async () => {
    const m = await freshMode('auto-tags');
    const p = await call('POST', '/projects', { name: 'Garden' }, m);
    const note = await call('POST', '/lists', { name: 'Seeds', kind: 'note', project_id: p.id }, m);
    const todo = await call('POST', '/lists', { name: 'Jobs', kind: 'todo', project_id: p.id }, m);
    const board = await call('POST', '/whiteboards', { name: 'Layout', project_id: p.id }, m);
    const link = await call('POST', '/resources', { title: 'Shop', value: 'https://example.com/shop', project_id: p.id }, m);
    await call('PUT', `/notes/of/project/${p.id}`, { body: 'Plan the beds' }, m);
    await call('POST', '/lists', { name: 'Elsewhere', kind: 'note' }, m);
    const auto = { id: `project:${p.id}`, name: 'Garden', color: null, auto: true, project_id: p.id };

    // In every listing, first, with the file's own tags after it.
    await call('POST', '/tags/set', { type: 'note', id: note.id, add: ['Spring', 'Outdoors'] }, m);
    const inside = await call('GET', `/files?project=${p.id}`, undefined, m);
    for (const f of inside.files) expect(f.tags[0]).toEqual(auto);
    expect(inside.files.find((f: any) => f.id === note.id).tags.map((t: any) => t.name)).toEqual(['Garden', 'Outdoors', 'Spring']);
    expect((await call('GET', '/files', undefined, m)).files.find((f: any) => f.name === 'Elsewhere').tags).toEqual([]);
    for (const [type, id] of [['note', note.id], ['todo', todo.id], ['whiteboard', board.id], ['link', link.id], ['project-note', p.id], ['project', p.id]]) {
      expect((await call('GET', `/tags/of/${type}/${id}`, undefined, m))[0]).toEqual(auto);
    }

    // The project's notes have their own tags too, not the project's.
    await call('POST', '/tags/set', { type: 'project-note', id: p.id, add: ['Ideas'] }, m);
    expect(names(await call('GET', `/tags/of/project-note/${p.id}`, undefined, m))).toEqual(['Garden', 'Ideas']);
    expect(names(await call('GET', `/tags/of/project/${p.id}`, undefined, m))).toEqual(['Garden']);

    // Listed with the profile's tags, after them; read only.
    const tags = await call('GET', '/tags', undefined, m);
    expect(tags.at(-1)).toMatchObject({ ...auto, status: 'active', count: null });
    await call('POST', '/tags/set', { type: 'note', id: note.id, remove: [auto.id] }, { ...m, expect: 400 });
    await call('POST', '/tags/set', { type: 'note', id: note.id, add: [auto.id] }, { ...m, expect: 400 });
    // Setting the whole set keeps it (it is not the owner's to set).
    const set = await call('POST', '/tags/set', { type: 'note', id: note.id, tags: [auto.id, 'Spring'] }, m);
    expect(set.tags.map((t: any) => t.name)).toEqual(['Garden', 'Spring']);
    await call('PATCH', `/tags/${encodeURIComponent(auto.id)}`, { name: 'X' }, { ...m, expect: 404 });

    // The Files filter: by its id or the project's name, with the owner's tags, anywhere.
    const all = ['Garden notes', 'Jobs', 'Layout', 'Seeds', 'Shop'];
    expect(names((await call('GET', `/files?tag=${encodeURIComponent(auto.id)}`, undefined, m)).files)).toEqual(all);
    expect(names((await call('GET', '/files?tag=garden', undefined, m)).files)).toEqual(all);
    expect(names((await call('GET', `/files?tag=${encodeURIComponent(auto.id)},Spring`, undefined, m)).files)).toEqual(['Seeds']);
    // No tag means none of the owner's own.
    expect(names((await call('GET', '/files?tag=none', undefined, m)).files)).toEqual(['Elsewhere', 'Jobs', 'Layout', 'Shop']);
    // Search finds the project's files by its name.
    expect(names((await call('GET', '/files?q=garde', undefined, m)).files)).toEqual(all);

    // Renaming the project renames the tag; deleting it takes the tag away.
    await call('PATCH', `/projects/${p.id}`, { name: 'Allotment' }, m);
    expect((await call('GET', `/tags/of/whiteboard/${board.id}`, undefined, m))[0].name).toBe('Allotment');
    // A file moved out of the project loses it.
    await call('POST', '/files/move', { items: [{ type: 'note', id: note.id }], folder_id: null }, m);
    expect(names(await call('GET', `/tags/of/note/${note.id}`, undefined, m))).toEqual(['Spring']);
    await call('DELETE', `/projects/${p.id}`, undefined, m);
    expect((await call('GET', '/tags', undefined, m)).some((t: any) => t.auto)).toBe(false);
  });

  it('works for the widgets and Claude', async () => {
    const m = await freshMode('auto-tags-claude');
    const p = await call('POST', '/projects', { name: 'Bike' }, m);
    const n = await call('POST', '/lists', { name: 'Parts', kind: 'note', project_id: p.id }, m);
    await call('PUT', `/notes/of/list/${n.id}`, { body: 'Chain' }, m);
    await call('POST', '/lists', { name: 'Other', kind: 'note' }, m);

    for (const tag of [`project:${p.id}`, 'bike']) {
      const w = await call('GET', `/widget/files?tag=${encodeURIComponent(tag)}`, undefined, m);
      expect(w.source).toMatchObject({ by: 'tag', id: `project:${p.id}`, name: 'Bike' });
      expect(w.files.map((f: any) => f.title)).toEqual(['Parts']);
    }
    const listed = await tool('list_files', { mode: m.mode, tags: ['Bike'] });
    expect(names(listed.files)).toEqual(['Parts']); // empty project notes stay quiet
    expect(listed.files[0].tags[0]).toMatchObject({ name: 'Bike', auto: true });
    expect((await tool('list_tags', { mode: m.mode })).find((t: any) => t.auto)).toMatchObject({ id: `project:${p.id}`, name: 'Bike' });
    expect(await toolError('untag_file', { mode: m.mode, type: 'note', id: n.id, tags: [`project:${p.id}`] })).toMatch(/automatic/);
  });
});
