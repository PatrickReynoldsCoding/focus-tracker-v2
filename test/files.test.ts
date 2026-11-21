import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { statements } from '../src/core/migrate';
import migration from '../migrations/0018_files.sql';
import { apiToken, BASE, call, mcp, tool, toolError, flagEverywhere } from './helpers';

const THUMB = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';

/** A mode of its own for each test, so listings start empty. */
async function freshMode(id: string) {
  await call('POST', '/modes', { label: id, id });
  return { mode: id };
}
const names = (xs: { name: string }[]) => xs.map((x) => x.name);

describe('files and folders', () => {
  it('gives every project a folder that follows its name and goes with it', async () => {
    const m = await freshMode('files-project');
    const p = await call('POST', '/projects', { name: 'Garden' }, m);
    let root = await call('GET', '/files', undefined, m);
    expect(root.folders).toHaveLength(1);
    expect(root.folders[0]).toMatchObject({ name: 'Garden', project_id: p.id, status: 'active' });
    const folder = root.folders[0];

    // Renaming the project renames its folder, and renaming the folder renames the project.
    await call('PATCH', `/projects/${p.id}`, { name: 'Garden shed' }, m);
    expect((await call('GET', `/folders/${folder.id}`, undefined, m)).name).toBe('Garden shed');
    await call('PATCH', `/folders/${folder.id}`, { name: 'Shed' }, m);
    expect((await call('GET', `/projects/${p.id}`, undefined, m)).name).toBe('Shed');

    // Not deletable by hand; a project folder cannot be made by hand.
    await call('DELETE', `/folders/${folder.id}`, undefined, { ...m, expect: 400 });
    await call('POST', '/folders', { name: 'Fake', project_id: p.id }, { ...m, expect: 400 });

    // Deleting the project removes its folder; what the owner filed there moves up, and Undo brings it all back.
    const sub = await call('POST', '/folders', { name: 'Ideas', parent_id: folder.id }, m);
    const loose = await call('POST', '/lists', { name: 'Loose note', kind: 'note', folder_id: folder.id }, m);
    expect(loose.project_id).toBe(p.id);
    const board = await call('POST', '/whiteboards', { name: 'Sketch', project_id: p.id }, m);
    expect(board.folder_id).toBe(folder.id);
    await call('DELETE', `/projects/${p.id}`, undefined, m);
    root = await call('GET', '/files', undefined, m);
    expect(names(root.folders)).toEqual(['Ideas']);
    expect(names(root.files)).toEqual(['Loose note']);
    expect(root.files[0].project_id).toBeNull();
    await call('POST', '/undo', {}, m);
    root = await call('GET', '/files', undefined, m);
    expect(names(root.folders)).toEqual(['Shed']);
    expect(root.files).toEqual([]);
    const inside = await call('GET', `/files?folder=${folder.id}`, undefined, m);
    expect(names(inside.folders)).toEqual(['Ideas']);
    expect(names(inside.files).sort()).toEqual(['Loose note', 'Shed notes', 'Sketch']);
    expect((await call('GET', `/files?project=${p.id}`, undefined, m)).folder.id).toBe(folder.id);
    expect(sub.parent_id).toBe(folder.id);
  });

  it('keeps a file’s project and folder in step', async () => {
    const m = await freshMode('files-sync');
    const p = await call('POST', '/projects', { name: 'Website' }, m);
    const pf = (await call('GET', `/files?project=${p.id}`, undefined, m)).folder;
    const plain = await call('POST', '/folders', { name: 'Reading' }, m);

    // Made with a project: in its folder. Moved out: no project. Moved back: the project's again.
    const list = await call('POST', '/lists', { name: 'Tasks', kind: 'todo', project_id: p.id }, m);
    expect(list.folder_id).toBe(pf.id);
    await call('POST', '/files/move', { items: [{ type: 'todo', id: list.id }], folder_id: plain.id }, m);
    expect(await call('GET', `/lists/${list.id}`, undefined, m)).toMatchObject({ folder_id: plain.id, project_id: null });
    await call('POST', '/files/move', { items: [{ type: 'todo', id: list.id }], folder_id: pf.id }, m);
    expect(await call('GET', `/lists/${list.id}`, undefined, m)).toMatchObject({ folder_id: pf.id, project_id: p.id });

    // Taking the project away (old project page or Claude) moves it to the top level.
    const wb = await call('POST', '/whiteboards', { name: 'Map', project_id: p.id }, m);
    await call('PATCH', `/whiteboards/${wb.id}`, { project_id: null }, m);
    expect(await call('GET', `/whiteboards/${wb.id}`, undefined, m)).toMatchObject({ folder_id: null, project_id: null });
    // Giving a project to a file inside a subfolder of that project leaves it where it is.
    const deep = await call('POST', '/folders', { name: 'Drafts', parent_id: pf.id }, m);
    const note = await call('POST', '/lists', { name: 'Draft', kind: 'note', folder_id: deep.id }, m);
    expect(note.project_id).toBe(p.id);
    await call('PATCH', `/lists/${note.id}`, { project_id: p.id }, m);
    expect((await call('GET', `/lists/${note.id}`, undefined, m)).folder_id).toBe(deep.id);

    // Moving a folder into a project's folder makes what is inside that project's; out again clears it.
    const res = await call('POST', '/resources', { title: 'Guide', value: 'https://example.com/guide', folder_id: plain.id }, m);
    expect(res).toMatchObject({ project_id: null, folder_id: plain.id, kind: 'link' });
    await call('POST', '/files/move', { items: [{ type: 'folder', id: plain.id }], folder_id: pf.id }, m);
    expect((await call('GET', `/resources/${res.id}`, undefined, m)).project_id).toBe(p.id);
    expect((await call('GET', `/projects/${p.id}/full`, undefined, m)).resources.map((r: any) => r.title)).toContain('Guide');
    await call('PATCH', `/folders/${plain.id}`, { parent_id: null }, m);
    expect((await call('GET', `/resources/${res.id}`, undefined, m)).project_id).toBeNull();

    // A folder cannot go inside itself; a project's notes cannot move.
    await call('PATCH', `/folders/${pf.id}`, { parent_id: deep.id }, { ...m, expect: 400 });
    await call('POST', '/files/move', { items: [{ type: 'project-note', id: p.id }], folder_id: null }, { ...m, expect: 400 });
    // Moves are one undo step.
    await call('POST', '/files/move', { items: [{ type: 'todo', id: list.id }, { type: 'note', id: note.id }], folder_id: plain.id }, m);
    await call('POST', '/undo', {}, m);
    expect((await call('GET', `/lists/${list.id}`, undefined, m)).folder_id).toBe(pf.id);
    expect((await call('GET', `/lists/${note.id}`, undefined, m)).folder_id).toBe(deep.id);
  });

  it('lists a folder, filters by type and searches names and note text everywhere below', async () => {
    const m = await freshMode('files-list');
    const p = await call('POST', '/projects', { name: 'Kitchen' }, m);
    const a = await call('POST', '/folders', { name: 'Alpha' }, m);
    await call('POST', '/folders', { name: 'beta', parent_id: a.id }, m);
    const n1 = await call('POST', '/lists', { name: 'Zebra note', kind: 'note' }, m);
    await call('PUT', `/notes/of/list/${n1.id}`, { body: 'Paint the **fence** blue' }, m);
    await call('POST', '/lists', { name: 'Apple list', kind: 'list', folder_id: a.id }, m);
    await call('POST', '/whiteboards', { name: 'Fence plan', project_id: p.id }, m);
    await call('POST', '/resources', { title: 'Spec', value: 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit', project_id: p.id }, m);
    // Shared by a category: stays on the Projects tab, not a file.
    const cat = await call('POST', '/categories', { label: 'Home' }, m);
    await call('POST', '/resources', { title: 'Shared', value: 'https://example.com/shared', category_id: cat.id }, m);
    // Not a link: not a file.
    await call('POST', '/resources', { title: 'Plumber', value: '+44 7700 900123', type: 'phone', project_id: p.id }, m);

    const root = await call('GET', '/files', undefined, m);
    expect(names(root.folders)).toEqual(['Alpha', 'Kitchen']);
    expect(names(root.files)).toEqual(['Zebra note']);
    expect(root.files[0]).toMatchObject({ type: 'note', preview: 'Paint the **fence** blue' });
    expect(root.path).toEqual([]);

    const kitchen = await call('GET', `/files?project=${p.id}`, undefined, m);
    expect(kitchen.path.map((x: any) => x.name)).toEqual(['Kitchen']);
    // An empty project note shows in its own folder only.
    expect(names(kitchen.files)).toEqual(['Fence plan', 'Kitchen notes', 'Spec']);
    expect(kitchen.files.find((f: any) => f.type === 'link')).toMatchObject({ kind: 'doc', url: expect.stringContaining('docs.google.com') });
    expect((await call('GET', '/files?type=notes', undefined, m)).files.map((f: any) => f.name)).toEqual(['Zebra note']);

    // Search: names and note text, everywhere below, with where each one is.
    const s = await call('GET', '/files?q=fence', undefined, m);
    expect(names(s.files)).toEqual(['Fence plan', 'Zebra note']);
    expect(s.files[0].location).toBe('Kitchen');
    expect((await call('GET', '/files?q=bet', undefined, m)).folders.map((f: any) => [f.name, f.location])).toEqual([['beta', 'Alpha']]);
    expect(names((await call('GET', `/files?folder=${a.id}&q=e`, undefined, m)).files)).toEqual(['Apple list']);
    expect(names((await call('GET', '/files?type=whiteboards,links', undefined, m)).files)).toEqual(['Fence plan', 'Spec']);
    // A search with % or _ finds them literally.
    expect((await call('GET', '/files?q=%25', undefined, m)).files).toEqual([]);

    // Last changed: writing a note's text counts.
    await call('PUT', `/notes/of/project/${p.id}`, { body: 'Measure the wall' }, m);
    const changed = await call('GET', '/files?type=notes&sort=changed', undefined, m);
    expect(names(changed.files)).toEqual(['Kitchen notes', 'Zebra note']);
    await call('GET', '/files?folder=nope', undefined, { ...m, expect: 400 });
  });

  it('deletes a folder by moving what is inside up, or with everything in it, and Undo brings it back', async () => {
    const m = await freshMode('files-delete');
    const top = await call('POST', '/folders', { name: 'Top' }, m);
    const mid = await call('POST', '/folders', { name: 'Mid', parent_id: top.id }, m);
    const inner = await call('POST', '/folders', { name: 'Inner', parent_id: mid.id }, m);
    const n = await call('POST', '/lists', { name: 'Kept', kind: 'note', folder_id: mid.id }, m);
    const w = await call('POST', '/whiteboards', { name: 'Deep board', folder_id: inner.id }, m);
    const p = await call('POST', '/projects', { name: 'Nested project' }, m);
    const pf = (await call('GET', `/files?project=${p.id}`, undefined, m)).folder;
    await call('PATCH', `/folders/${pf.id}`, { parent_id: inner.id }, m);
    expect(await call('GET', `/folders/${mid.id}/count`, undefined, m)).toEqual({ folders: 2, files: 2, projects: 1 });

    await call('DELETE', `/folders/${mid.id}`, undefined, m);
    const t = await call('GET', `/files?folder=${top.id}`, undefined, m);
    expect(names(t.folders)).toEqual(['Inner']);
    expect(names(t.files)).toEqual(['Kept']);
    await call('POST', '/undo', {}, m);
    expect((await call('GET', `/lists/${n.id}`, undefined, m)).folder_id).toBe(mid.id);

    const r = await call('DELETE', `/folders/${mid.id}?contents=delete`, undefined, m);
    expect(r.items_deleted).toBe(3); // the note, the board and Inner
    await call('GET', `/lists/${n.id}`, undefined, { ...m, expect: 404 });
    await call('GET', `/whiteboards/${w.id}`, undefined, { ...m, expect: 404 });
    // A project's folder inside is not deleted: it moves up, with the project.
    expect((await call('GET', `/folders/${pf.id}`, undefined, m)).parent_id).toBe(top.id);
    await call('POST', '/undo', {}, m);
    expect((await call('GET', `/whiteboards/${w.id}`, undefined, m)).folder_id).toBe(inner.id);
    expect((await call('GET', `/folders/${pf.id}`, undefined, m)).parent_id).toBe(inner.id);
  });

  it('serves a whiteboard’s preview as an image', async () => {
    const w = await call('POST', '/whiteboards', { name: 'With preview' });
    await call('PUT', `/whiteboards/${w.id}/thumbnail`, { thumbnail: THUMB });
    const { SELF } = await import('cloudflare:test');
    const res = await SELF.fetch(`${BASE}/api/whiteboards/${w.id}/thumbnail`, { headers: { Authorization: `Bearer ${await apiToken()}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/webp');
    expect(new Uint8Array(await res.arrayBuffer()).slice(0, 4)).toEqual(new Uint8Array([82, 73, 70, 70])); // RIFF
    const none = await call('POST', '/whiteboards', { name: 'No preview' });
    await call('GET', `/whiteboards/${none.id}/thumbnail`, undefined, { expect: 404 });
  });

  it('puts existing project lists, boards and links into project folders (migration 0018)', async () => {
    const at = '2026-10-01T00:00:00.000Z';
    const ins = (sql: string) => env.DB.prepare(sql).run();
    await ins(`INSERT INTO projects (id, mode, name, status, ord, created, updated_at) VALUES ('oldproj01', 'personal', 'Old project', 'active', 1, '${at}', '${at}')`);
    await ins(`INSERT INTO lists (id, mode, name, kind, project_id, ord, created, updated_at) VALUES ('oldlist01', 'personal', 'Old list', 'note', 'oldproj01', 1, '${at}', '${at}')`);
    await ins(`INSERT INTO lists (id, mode, name, kind, ord, created, updated_at) VALUES ('oldlist02', 'personal', 'Loose', 'note', 2, '${at}', '${at}')`);
    await ins(`INSERT INTO whiteboards (id, mode, name, project_id, ord, created, updated_at) VALUES ('oldboard9', 'personal', 'Old board', 'oldproj01', 1, '${at}', '${at}')`);
    await ins(`INSERT INTO resources (id, mode, project_id, title, type, value, ord, created, updated_at) VALUES ('oldres001', 'personal', 'oldproj01', 'Old link', 'link', 'https://example.com', 1, '${at}', '${at}')`);
    // Before the data statements run, a file with a project but no folder still shows in the project's folder.
    const data = statements(migration).filter((s) => /^(INSERT|UPDATE)/.test(s));
    await env.DB.batch(data.map((s) => env.DB.prepare(s)));
    const f = await env.DB.prepare("SELECT * FROM folders WHERE project_id = 'oldproj01'").first<any>();
    expect(f).toMatchObject({ id: 'pf-oldproj01', mode: 'personal', name: 'Old project', parent_id: null });
    for (const [t, id] of [['lists', 'oldlist01'], ['whiteboards', 'oldboard9'], ['resources', 'oldres001']]) {
      expect(await env.DB.prepare(`SELECT folder_id FROM ${t} WHERE id = ?`).bind(id).first('folder_id')).toBe('pf-oldproj01');
    }
    expect(await env.DB.prepare("SELECT folder_id FROM lists WHERE id = 'oldlist02'").first('folder_id')).toBeNull();
    // Running it again changes nothing (one folder per project).
    await env.DB.batch(data.map((s) => env.DB.prepare(s)));
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM folders WHERE project_id = 'oldproj01'").first('n')).toBe(1);
    const listed = await call('GET', '/files?project=oldproj01');
    expect(names(listed.files)).toEqual(['Old board', 'Old link', 'Old list', 'Old project notes']);
  });

  it('shows a project’s file in its folder even before it has a folder_id', async () => {
    const m = await freshMode('files-fallback');
    const p = await call('POST', '/projects', { name: 'Fallback' }, m);
    const l = await call('POST', '/lists', { name: 'Raw', kind: 'list', project_id: p.id }, m);
    await env.DB.prepare('UPDATE lists SET folder_id = NULL WHERE id = ?').bind(l.id).run();
    expect(names((await call('GET', `/files?project=${p.id}`, undefined, m)).files)).toContain('Raw');
    expect(names((await call('GET', '/files', undefined, m)).files)).not.toContain('Raw');
  });

  it('gives Claude file and folder tools, hidden while the flag is off', async () => {
    const m = 'files-claude';
    await freshMode(m);
    const f = await tool('create_folder', { name: 'Research', mode: m });
    const sub = await tool('create_folder', { name: 'Old', parent_id: f.id, mode: m });
    await tool('rename_folder', { id: sub.id, name: 'Archive', mode: m });
    const l = await tool('create_list', { name: 'Reading list', kind: 'list', folder_id: f.id, mode: m });
    expect(l.folder_id).toBe(f.id);
    const w = await tool('create_whiteboard', { name: 'Mind map', folder_id: sub.id, mode: m });
    expect(w.folder_id).toBe(sub.id);
    const link = await tool('add_resource', { value: 'https://example.com/paper.pdf', folder_id: f.id, mode: m });
    expect(link).toMatchObject({ folder_id: f.id, kind: 'pdf' });
    let listed = await tool('list_files', { folder_id: f.id, mode: m });
    expect(names(listed.folders)).toEqual(['Archive']);
    expect(names(listed.files)).toEqual(['paper.pdf', 'Reading list'].sort((a, b) => a.localeCompare(b)));
    expect(names((await tool('list_files', { query: 'mind', mode: m })).files)).toEqual(['Mind map']);
    await tool('move_files', { items: [{ type: 'list', id: l.id }], folder_id: sub.id, mode: m });
    await tool('move_folder', { id: sub.id, parent_id: null, mode: m });
    listed = await tool('list_files', { mode: m });
    expect(names(listed.folders)).toEqual(['Archive', 'Research']);
    await tool('delete_folder', { id: sub.id, mode: m });
    listed = await tool('list_files', { mode: m });
    expect(names(listed.files)).toEqual(['Mind map', 'Reading list']);
    const p = await call('POST', '/projects', { name: 'Tooling' }, { mode: m });
    expect(await toolError('delete_folder', { id: (await tool('list_files', { project_id: p.id, mode: m })).folder.id, mode: m })).toMatch(/folder of a project/);

    await flagEverywhere('files-tab', false);
    try {
      const { tools } = await mcp<any>('tools/list');
      expect(tools.some((t: any) => t.name === 'list_files')).toBe(false);
      await call('GET', '/files', undefined, { expect: 404 });
      // Folders keep working underneath, so data stays in step.
      expect((await call('POST', '/lists', { name: 'Still filed', kind: 'note', project_id: p.id }, { mode: m })).folder_id).toBeTruthy();
    } finally {
      await flagEverywhere('files-tab', true);
    }
  });
});
