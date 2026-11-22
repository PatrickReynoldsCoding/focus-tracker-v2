// Files › Projects › <category> › <project> (D52): virtual folders made from the categories, a
// project's folder in its category's folder, moving it there changes the project's category,
// and every reader of folders (listing, path, search, /api/folders, the widgets, Claude) agrees.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { statements } from '../src/core/migrate';
import migration from '../migrations/0025_projects_tree.sql';
import { call, tool, toolError } from './helpers';

async function freshMode(id: string) {
  await call('POST', '/modes', { label: id, id });
  return { mode: id };
}
const names = (xs: { name: string }[]) => xs.map((x) => x.name);

describe('the Projects tree', () => {
  it('shows Projects, a folder per category in order with its colour, and No category', async () => {
    const m = await freshMode('tree-cats');
    const work = await call('POST', '/categories', { label: 'Work', color: 'blue' }, m);
    const home = await call('POST', '/categories', { label: 'Home', color: '#336699' }, m);
    const site = await call('POST', '/projects', { name: 'Website', category_id: work.id }, m);
    await call('POST', '/projects', { name: 'Shed', category_id: home.id }, m);
    const loose = await call('POST', '/projects', { name: 'Loose ends' }, m);
    await call('POST', '/folders', { name: 'Reading' }, m);

    const root = await call('GET', '/files', undefined, m);
    expect(names(root.folders)).toEqual(['Projects', 'Reading']);
    expect(root.folders[0]).toMatchObject({ id: 'vf:projects', virtual: 'projects' });
    expect(root.folders.some((f: any) => f.project_id)).toBe(false);

    const projects = await call('GET', '/files?folder=vf:projects', undefined, m);
    expect(names(projects.folders)).toEqual(['Work', 'Home', 'No category']); // the categories' order, not by name
    expect(projects.folders[0]).toMatchObject({ id: `vf:cat:${work.id}`, virtual: 'category', category_id: work.id, color: 'blue', count: 1 });
    expect(projects.folders[1]).toMatchObject({ color: '#336699' });
    expect(projects.path).toEqual([{ id: 'vf:projects', name: 'Projects', project_id: null, virtual: 'projects' }]);

    const inWork = await call('GET', `/files?folder=vf:cat:${work.id}`, undefined, m);
    expect(names(inWork.folders)).toEqual(['Website']);
    expect(inWork.path.map((c: any) => c.name)).toEqual(['Projects', 'Work']);
    expect(names((await call('GET', '/files?folder=vf:nocat', undefined, m)).folders)).toEqual(['Loose ends']);

    // The project's folder keeps its id and address; its path goes through Projects and the category.
    const pf = (await call('GET', `/files?project=${site.id}`, undefined, m)).folder;
    const inside = await call('GET', `/files?folder=${pf.id}`, undefined, m);
    expect(inside.path.map((c: any) => c.name)).toEqual(['Projects', 'Work', 'Website']);
    expect(names(inside.files)).toEqual(['Website notes']);

    // Order, rename, colour and delete of a category show at once (nothing stored to keep in step).
    await call('POST', `/categories/${home.id}/move`, { index: 0 }, m);
    await call('PATCH', `/categories/${work.id}`, { label: 'Job', color: 'green' }, m);
    let tree = await call('GET', '/files?folder=vf:projects', undefined, m);
    expect(names(tree.folders)).toEqual(['Home', 'Job', 'No category']);
    expect(tree.folders[1].color).toBe('green');
    await call('POST', `/categories/${work.id}/delete`, {}, m);
    tree = await call('GET', '/files?folder=vf:projects', undefined, m);
    expect(names(tree.folders)).toEqual(['Home', 'No category']);
    expect(names((await call('GET', '/files?folder=vf:nocat', undefined, m)).folders)).toEqual(['Loose ends', 'Website']);
    await call('POST', '/undo', {}, m);
    expect(names((await call('GET', `/files?folder=vf:cat:${work.id}`, undefined, m)).folders)).toEqual(['Website']);
    // Search says where things are, and finds category folders by name.
    const s = await call('GET', '/files?q=website', undefined, m);
    expect(s.files.find((f: any) => f.name === 'Website notes')).toBeUndefined(); // empty project notes stay quiet
    expect(s.folders.map((f: any) => [f.name, f.location])).toEqual([['Website', 'Projects › Job']]);
    expect((await call('GET', '/files?q=job', undefined, m)).folders.map((f: any) => f.name)).toContain('Job');
    await call('GET', '/files?folder=vf:cat:nope', undefined, { ...m, expect: 400 });
  });

  it('moving a project’s folder to another category’s folder changes the project’s category', async () => {
    const m = await freshMode('tree-move');
    const a = await call('POST', '/categories', { label: 'A' }, m);
    const b = await call('POST', '/categories', { label: 'B' }, m);
    const p = await call('POST', '/projects', { name: 'Mover', category_id: a.id }, m);
    const pf = (await call('GET', `/files?project=${p.id}`, undefined, m)).folder;
    const own = await call('POST', '/folders', { name: 'Mine' }, m);

    await call('POST', '/files/move', { items: [{ type: 'folder', id: pf.id }], folder_id: `vf:cat:${b.id}` }, m);
    expect((await call('GET', `/projects/${p.id}`, undefined, m)).category_id).toBe(b.id);
    expect((await call('GET', `/folders/${pf.id}`, undefined, m)).parent_id).toBe(`vf:cat:${b.id}`);
    await call('PATCH', `/folders/${pf.id}`, { parent_id: 'vf:nocat' }, m);
    expect((await call('GET', `/projects/${p.id}`, undefined, m)).category_id).toBeNull();
    await call('POST', '/undo', {}, m);
    expect((await call('GET', `/projects/${p.id}`, undefined, m)).category_id).toBe(b.id);
    // Claude's move_folder does the same.
    await tool('move_folder', { id: pf.id, parent_id: `vf:cat:${a.id}`, mode: m.mode });
    expect((await call('GET', `/projects/${p.id}`, undefined, m)).category_id).toBe(a.id);

    // A project's folder cannot go into a folder of the owner's or into Projects itself.
    await call('POST', '/files/move', { items: [{ type: 'folder', id: pf.id }], folder_id: own.id }, { ...m, expect: 400 });
    await call('POST', '/files/move', { items: [{ type: 'folder', id: pf.id }], folder_id: 'vf:projects' }, { ...m, expect: 400 });
    // Files and other folders cannot go into the virtual folders; they cannot be made there.
    const note = await call('POST', '/lists', { name: 'A note', kind: 'note' }, m);
    expect((await call('POST', '/files/move', { items: [{ type: 'note', id: note.id }], folder_id: `vf:cat:${a.id}` }, { ...m, expect: 400 })).error).toMatch(/project’s folder/);
    await call('PATCH', `/lists/${note.id}`, { folder_id: 'vf:projects' }, { ...m, expect: 400 });
    await call('POST', '/lists', { name: 'Nope', kind: 'note', folder_id: 'vf:nocat' }, { ...m, expect: 400 });
    await call('POST', '/files/move', { items: [{ type: 'folder', id: own.id }], folder_id: 'vf:nocat' }, { ...m, expect: 400 });
    await call('POST', '/folders', { name: 'In a category', parent_id: `vf:cat:${a.id}` }, { ...m, expect: 400 });
    // The virtual folders cannot be moved or deleted; a category's folder renames its category.
    await call('POST', '/files/move', { items: [{ type: 'folder', id: 'vf:projects' }], folder_id: own.id }, { ...m, expect: 400 });
    await call('DELETE', `/folders/vf:cat:${a.id}`, undefined, { ...m, expect: 400 });
    await call('DELETE', '/folders/vf:projects', undefined, { ...m, expect: 400 });
    await call('PATCH', '/folders/vf:projects', { name: 'Stuff' }, { ...m, expect: 400 });
    expect((await call('PATCH', `/folders/vf:cat:${a.id}`, { name: 'Alpha' }, m)).name).toBe('Alpha');
    expect((await call('GET', `/categories/${a.id}`, undefined, m)).label).toBe('Alpha');
    expect(await toolError('delete_folder', { id: 'vf:projects', mode: m.mode })).toMatch(/cannot be deleted/);
    expect(await call('GET', `/folders/vf:cat:${a.id}/count`, undefined, m)).toMatchObject({ folders: 1, projects: 1 });
  });

  it('gives the same tree to /api/folders, the widgets and Claude', async () => {
    const m = await freshMode('tree-readers');
    const c = await call('POST', '/categories', { label: 'Garden' }, m);
    const p = await call('POST', '/projects', { name: 'Beds', category_id: c.id }, m);
    const pf = (await call('GET', `/files?project=${p.id}`, undefined, m)).folder;
    const n = await call('POST', '/lists', { name: 'Seeds', kind: 'note', project_id: p.id }, m);
    await call('PUT', `/notes/of/list/${n.id}`, { body: 'Carrots' }, m);
    const sub = await call('POST', '/folders', { name: 'Plans', parent_id: pf.id }, m);
    await call('POST', '/lists', { name: 'Layout', kind: 'list', folder_id: sub.id }, m);
    await call('POST', '/lists', { name: 'Elsewhere', kind: 'note' }, m);

    const folders = await call('GET', '/folders?limit=2000', undefined, m);
    const byId = new Map(folders.map((f: any) => [f.id, f]));
    expect(byId.get('vf:projects')).toMatchObject({ name: 'Projects', parent_id: null });
    expect(byId.get(`vf:cat:${c.id}`)).toMatchObject({ name: 'Garden', parent_id: 'vf:projects' });
    expect(byId.get(pf.id)).toMatchObject({ name: 'Beds', parent_id: `vf:cat:${c.id}` });
    expect(byId.get(sub.id)).toMatchObject({ parent_id: pf.id });
    expect((await call('GET', '/folders/vf:projects', undefined, m)).name).toBe('Projects');

    for (const id of ['vf:projects', `vf:cat:${c.id}`]) {
      const w = await call('GET', `/widget/files?folder=${encodeURIComponent(id)}&kinds=note,list`, undefined, m);
      expect(w.missing).toBe(false);
      expect(w.files.map((f: any) => f.title).sort()).toEqual(['Layout', 'Seeds']);
    }
    expect((await call('GET', `/widget/files?folder=${encodeURIComponent(`vf:cat:${c.id}`)}`, undefined, m)).source).toMatchObject({ by: 'folder', name: 'Garden' });
    expect((await call('GET', '/widget/files?folder=vf:nocat&kinds=note', undefined, m)).files).toEqual([]);
    expect((await call('GET', '/widget/files?folder=vf:cat:gone', undefined, m)).missing).toBe(true);

    const top = await tool('list_files', { mode: m.mode });
    expect(names(top.folders)).toEqual(['Projects']);
    expect(names((await tool('list_files', { folder_id: `vf:cat:${c.id}`, mode: m.mode })).folders)).toEqual(['Beds']);
    expect((await tool('list_files', { project_id: p.id, mode: m.mode })).path.map((x: any) => x.name)).toEqual(['Projects', 'Garden', 'Beds']);
    expect(await toolError('move_files', { items: [{ type: 'note', id: n.id }], folder_id: 'vf:projects', mode: m.mode })).toMatch(/Projects/);
  });

  it('puts a project’s folder that sat in a folder back under Projects and moves project-note tags (migration 0025)', async () => {
    const m = await freshMode('tree-migrate');
    const own = await call('POST', '/folders', { name: 'Clients' }, m);
    const p = await call('POST', '/projects', { name: 'Client A' }, m);
    const pf = (await call('GET', `/files?project=${p.id}`, undefined, m)).folder;
    const note = await call('POST', '/lists', { name: 'Kept in it', kind: 'note', folder_id: pf.id }, m);
    await env.DB.prepare('UPDATE folders SET parent_id = ? WHERE id = ?').bind(own.id, pf.id).run();
    await env.DB.prepare("INSERT INTO tag_links (id, mode, tag_id, kind, target_id, created, updated_at) VALUES ('tlmig00001', ?, 'tagmig0001', 'projects', ?, '', '')").bind(m.mode, p.id).run();
    await env.DB.prepare("INSERT INTO tags (id, mode, name, created, updated_at) VALUES ('tagmig0001', ?, 'Urgent', '', '')").bind(m.mode).run();
    const before = await env.DB.prepare('SELECT id, name, project_id FROM folders WHERE mode = ? ORDER BY id').bind(m.mode).all();

    await env.DB.batch(statements(migration).map((s) => env.DB.prepare(s)));
    const after = await env.DB.prepare('SELECT id, name, project_id, parent_id FROM folders WHERE id = ?').bind(pf.id).first<any>();
    expect(after).toMatchObject({ id: pf.id, name: 'Client A', project_id: p.id, parent_id: null });
    expect((await env.DB.prepare('SELECT id, name, project_id FROM folders WHERE mode = ? ORDER BY id').bind(m.mode).all()).results).toEqual(before.results);
    expect((await call('GET', `/lists/${note.id}`, undefined, m)).folder_id).toBe(pf.id);
    expect(await env.DB.prepare("SELECT kind FROM tag_links WHERE id = 'tlmig00001'").first('kind')).toBe('project-notes');
    const pn = (await call('GET', `/files?project=${p.id}`, undefined, m)).files.find((f: any) => f.type === 'project-note');
    expect(pn.tags.map((t: any) => t.name)).toEqual(['Client A', 'Urgent']);
  });
});
