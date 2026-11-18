import { describe, expect, it } from 'vitest';
import { call, tool } from './helpers';

const pause = () => new Promise((r) => setTimeout(r, 5));

describe('Today panels', () => {
  it('shows notes and lists on Today in the order they were added', async () => {
    const a = await call('POST', '/lists', { name: 'First note', kind: 'note' });
    const b = await call('POST', '/lists', { name: 'Shopping', kind: 'list' });
    const c = await call('POST', '/lists', { name: 'Chores', kind: 'todo' });
    await call('PUT', `/notes/of/list/${a.id}`, { body: 'Hello **world**' });
    await call('POST', '/tasks', { list_id: b.id, title: 'Milk', note: 'semi-skimmed' });
    await call('POST', '/todos', { list_id: c.id, title: 'Sweep' });
    // added in the order c, a, b
    await call('PUT', '/today-panels/show', { list_id: c.id });
    await pause();
    await call('PUT', '/today-panels/show', { list_id: a.id });
    await pause();
    await call('PUT', '/today-panels/show', { list_id: b.id });
    const items = await call('GET', '/today-panels');
    const mine = items.filter((i: any) => [a.id, b.id, c.id].includes(i.id));
    expect(mine.map((i: any) => i.id)).toEqual([c.id, a.id, b.id]);
    expect(mine[0]).toMatchObject({ type: 'list', kind: 'todo' });
    expect(mine[0].groups[0].todos[0].title).toBe('Sweep');
    expect(mine[1]).toMatchObject({ type: 'note', body: 'Hello **world**' });
    expect(mine[2].columns[0].cards[0]).toMatchObject({ title: 'Milk', note: 'semi-skimmed' });
    // off again
    await call('PUT', '/today-panels/show', { list_id: a.id, on: false });
    expect((await call('GET', '/today-panels')).some((i: any) => i.id === a.id)).toBe(false);
    // the ticked checkbox on the list page (a plain PATCH) counts as adding, at the end
    await call('PATCH', `/lists/${a.id}`, { show_today: true });
    const again = (await call('GET', '/today-panels')).filter((i: any) => [a.id, b.id, c.id].includes(i.id));
    expect(again.map((i: any) => i.id)).toEqual([c.id, b.id, a.id]);
  });

  it('puts a project’s notes on Today, even when it has none yet', async () => {
    const p = await call('POST', '/projects', { name: 'Garden' });
    const avail = await call('GET', '/today-panels/available');
    expect(avail.some((x: any) => x.project_id === p.id)).toBe(false); // no notes yet
    await call('PUT', '/today-panels/show', { project_id: p.id });
    let items = await call('GET', '/today-panels');
    expect(items.find((i: any) => i.project_id === p.id)).toMatchObject({ type: 'note', kind: 'project', name: 'Garden', body: '' });
    await call('PUT', `/notes/of/project/${p.id}`, { body: 'Prune roses' });
    items = await call('GET', '/today-panels');
    expect(items.find((i: any) => i.project_id === p.id).body).toBe('Prune roses');
    await call('PUT', '/today-panels/show', { project_id: p.id, on: false });
    expect((await call('GET', '/today-panels')).some((i: any) => i.project_id === p.id)).toBe(false);
    expect((await call('GET', '/today-panels/available')).some((x: any) => x.project_id === p.id)).toBe(true);
    await call('PUT', '/today-panels/show', {}, { expect: 400 });
    await call('PUT', '/today-panels/show', { project_id: 'nope-nope' }, { expect: 404 });
  });

  it('stores how a list shows on Today and checks the seconds', async () => {
    const l = await call('POST', '/lists', { name: 'Quotes', kind: 'list' });
    expect(l).toMatchObject({ display: 'full', seconds: 30 });
    const u = await call('PATCH', `/lists/${l.id}`, { display: 'one', seconds: 12 });
    expect(u).toMatchObject({ display: 'one', seconds: 12 });
    await call('PATCH', `/lists/${l.id}`, { seconds: 4 }, { expect: 400 });
    await call('PATCH', `/lists/${l.id}`, { seconds: 3601 }, { expect: 400 });
    await call('PATCH', `/lists/${l.id}`, { display: 'sometimes' }, { expect: 400 });
  });

  it('links a list to a project and shows it on the project', async () => {
    const p = await call('POST', '/projects', { name: 'Linked' });
    const l = await call('POST', '/lists', { name: 'Project list', kind: 'list', project_id: p.id });
    expect((await call('GET', `/projects/${p.id}/full`)).lists.map((x: any) => x.id)).toContain(l.id);
    await call('PATCH', `/lists/${l.id}`, { project_id: null });
    expect((await call('GET', `/projects/${p.id}/full`)).lists).toHaveLength(0);
  });

  it('offers the banners with the project of a reminder', async () => {
    const p = await call('POST', '/projects', { name: 'Reminded' });
    await call('POST', '/reminders', { project_id: p.id, text: 'Pick it up', due: '2000-01-01T00:00:00Z' });
    await call('POST', '/reminders', { text: 'No project', due: '2000-01-01T00:00:00Z' });
    const b = await call('GET', '/today-panels/banners');
    const mine = b.find((x: any) => x.project_id === p.id);
    expect(mine).toMatchObject({ kind: 'reminder', title: 'Reminded', body: 'Pick it up', project_name: 'Reminded' });
    expect(b.find((x: any) => x.body === 'No project').project_id).toBeNull();
    expect(mine.dedupe_key).toBeUndefined();
    await call('POST', `/notifications/${mine.id}/dismiss`);
    expect((await call('GET', '/today-panels/banners')).some((x: any) => x.id === mine.id)).toBe(false);
  });

  it('has the one-at-a-time flag on by default and a Claude tool', async () => {
    const f = (await call('GET', '/features')).find((x: any) => x.id === 'list-one-at-a-time');
    expect(f.enabled).toBe(true);
    const l = await call('POST', '/lists', { name: 'By Claude', kind: 'note' });
    await tool('show_on_today', { list_id: l.id });
    expect((await call('GET', '/today-panels')).some((i: any) => i.id === l.id)).toBe(true);
    await tool('show_on_today', { list_id: l.id, on: false });
    expect((await call('GET', '/today-panels')).some((i: any) => i.id === l.id)).toBe(false);
  });
});
