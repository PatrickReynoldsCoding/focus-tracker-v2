import { describe, expect, it } from 'vitest';
import { call, tool } from './helpers';

describe('project labels', () => {
  it('has the project-labels flag on by default, switchable', async () => {
    const find = async () => (await call('GET', '/features')).find((x: any) => x.id === 'project-labels');
    expect(await find()).toMatchObject({ enabled: true, label: 'Project labels' });
    await call('PUT', '/features/project-labels', { enabled: false });
    expect((await find()).enabled).toBe(false);
    await call('PUT', '/features/project-labels', { enabled: true });
  });

  it('gives each file its project’s name (REST and list_files), none for a file without a project', async () => {
    const m = { mode: 'labels' };
    await call('POST', '/modes', { label: 'Labels', id: 'labels' });
    const p = await call('POST', '/projects', { name: 'Bathroom refit' }, m);
    const note = await call('POST', '/lists', { name: 'Tiles', kind: 'note', project_id: p.id }, m);
    await call('POST', '/lists', { name: 'Loose', kind: 'note' }, m);
    const all = await call('GET', '/files?type=notes', undefined, m);
    expect(all.files.find((f: any) => f.id === note.id)).toMatchObject({ project_id: p.id, project_name: 'Bathroom refit' });
    expect(all.files.find((f: any) => f.name === 'Loose')).toMatchObject({ project_id: null, project_name: null });

    const viaTool = await tool('list_files', { mode: 'labels', type: 'notes' });
    expect(viaTool.files.find((f: any) => f.id === note.id).project_name).toBe('Bathroom refit');
    // Renamed: the next listing says the new name.
    await call('PATCH', `/projects/${p.id}`, { name: 'Bathroom' }, m);
    expect((await call('GET', '/files?type=notes', undefined, m)).files.find((f: any) => f.id === note.id).project_name).toBe('Bathroom');
  });

  it('says which project each to-do list belongs to on Today', async () => {
    const m = { mode: 'labels2' };
    await call('POST', '/modes', { label: 'Labels 2', id: 'labels2' });
    const p = await call('POST', '/projects', { name: 'Shed' }, m);
    const mine = await call('POST', '/lists', { name: 'Shed jobs', kind: 'todo', project_id: p.id }, m);
    const loose = await call('POST', '/lists', { name: 'Errands', kind: 'todo' }, m);
    const t = await call('GET', '/today', undefined, m);
    expect(t.todo_list_projects).toEqual({ [mine.id]: p.id });
    expect(t.todo_list_projects[loose.id]).toBeUndefined();
  });
});
