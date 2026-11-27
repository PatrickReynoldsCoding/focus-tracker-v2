// The focus queue (D67, flag focus-queue): an ordered queue of cards and to-dos, the first is Now.
import { describe, expect, it } from 'vitest';
import { call, tool, toolError } from './helpers';

let n = 0;
async function fresh() {
  const m = await call('POST', '/modes', { label: `Queue ${++n} ${Math.random().toString(36).slice(2, 6)}` });
  return m.id as string;
}
const queue = (mode: string) => call('GET', '/focus-queue', undefined, { mode });
const add = (mode: string, body: Record<string, unknown>) => call('POST', '/focus-queue', body, { mode });
const titles = (items: any[]) => items.map((i) => i.title);

async function setup(mode: string) {
  const p = await call('POST', '/projects', { name: 'Shed' }, { mode });
  const card = await call('POST', '/tasks', { project_id: p.id, title: 'Fix roof' }, { mode });
  const a = await call('POST', '/todos', { title: 'Buy nails' }, { mode });
  const b = await call('POST', '/todos', { title: 'Call Sam' }, { mode });
  return { p, card, a, b };
}

describe('the focus queue', () => {
  it('adds at the end, adds now, moves a duplicate, reorders and removes', async () => {
    const mode = await fresh();
    const { p, card, a, b } = await setup(mode);
    expect(await queue(mode)).toEqual([]);
    let q = await add(mode, { task_id: card.id });
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ task_id: card.id, title: 'Fix roof', done: null, project_id: p.id, project_name: 'Shed', list_id: null, list_name: null });
    expect(Object.keys(q[0]).sort()).toEqual(['done', 'id', 'list_id', 'list_name', 'ord', 'project_id', 'project_name', 'task_id', 'title']);
    q = await add(mode, { task_id: a.id, at: 'end', id: 'fq-client-1' });
    expect(q[1].id).toBe('fq-client-1');
    expect(q[1].list_id).toBe(a.list_id);
    expect(typeof q[1].list_name).toBe('string');
    q = await add(mode, { task_id: b.id, at: 'now' });
    expect(titles(q)).toEqual(['Call Sam', 'Fix roof', 'Buy nails']);
    // Adding a queued task again moves it, never twice.
    q = await add(mode, { task_id: b.id });
    expect(titles(q)).toEqual(['Fix roof', 'Buy nails', 'Call Sam']);
    q = await add(mode, { task_id: a.id, at: 'now' });
    expect(titles(q)).toEqual(['Buy nails', 'Fix roof', 'Call Sam']);
    // Reorder.
    q = await call('POST', `/focus-queue/${q[0].id}/move`, { index: 2 }, { mode });
    expect(titles(q)).toEqual(['Fix roof', 'Call Sam', 'Buy nails']);
    await call('POST', `/focus-queue/${q[0].id}/move`, {}, { mode, expect: 400 });
    // Remove.
    q = await call('DELETE', `/focus-queue/${q[1].id}`, undefined, { mode });
    expect(titles(q)).toEqual(['Fix roof', 'Buy nails']);
    await call('DELETE', '/focus-queue/nope-nope', undefined, { mode, expect: 404 });
    await call('POST', '/focus-queue', { task_id: 'nope-nope' }, { mode, expect: 400 });
    await call('POST', '/focus-queue', { task_id: a.id, at: 'soon' }, { mode, expect: 400 });
  });

  it('lets go of a task ticked done (tick route, moved into Done, Claude) or deleted', async () => {
    const mode = await fresh();
    const { p, card, a, b } = await setup(mode);
    const extra = await call('POST', '/tasks', { project_id: p.id, title: 'Paint' }, { mode });
    for (const t of [card, a, b, extra]) await add(mode, { task_id: t.id });
    // Tick route.
    await call('POST', `/tasks/${card.id}/tick`, { done: true }, { mode });
    expect(titles(await queue(mode))).toEqual(['Buy nails', 'Call Sam', 'Paint']);
    expect((await call('GET', '/today', undefined, { mode })).focus_now.title).toBe('Buy nails');
    // Moved into the Done column.
    const full = await call('GET', `/projects/${p.id}/full`, undefined, { mode });
    const done = full.columns.find((c: any) => c.is_done);
    await call('POST', `/tasks/${extra.id}/move`, { column_id: done.id }, { mode });
    expect(titles(await queue(mode))).toEqual(['Buy nails', 'Call Sam']);
    // Claude's tick.
    await tool('tick_todo', { id: a.id, mode });
    expect(titles(await queue(mode))).toEqual(['Call Sam']);
    // Undo brings the tick and the queue place back together.
    await call('POST', '/undo', undefined, { mode });
    expect(titles(await queue(mode))).toEqual(['Buy nails', 'Call Sam']);
    // Deleting a task takes it out.
    await call('DELETE', `/todos/${b.id}`, undefined, { mode });
    expect(titles(await queue(mode))).toEqual(['Buy nails']);
    await call('POST', '/undo', undefined, { mode });
    expect(titles(await queue(mode))).toEqual(['Buy nails', 'Call Sam']);
  });

  it('gives today its focus_now, or null', async () => {
    const mode = await fresh();
    const { card, a } = await setup(mode);
    expect((await call('GET', '/today', undefined, { mode })).focus_now).toBeNull();
    await add(mode, { task_id: card.id });
    await add(mode, { task_id: a.id, at: 'now' });
    const t = await call('GET', '/today', undefined, { mode });
    expect(t.focus_now).toMatchObject({ task_id: a.id, title: 'Buy nails' });
    await call('PUT', '/features/focus-queue', { enabled: false }, { mode });
    expect((await call('GET', '/today', undefined, { mode })).focus_now).toBeNull();
  });

  it('keeps each profile’s queue apart', async () => {
    const one = await fresh();
    const two = await fresh();
    const { card } = await setup(one);
    await add(one, { task_id: card.id });
    expect(await queue(two)).toEqual([]);
    await call('POST', '/focus-queue', { task_id: card.id }, { mode: two, expect: 400 });
    const q = await queue(one);
    await call('DELETE', `/focus-queue/${q[0].id}`, undefined, { mode: two, expect: 404 });
    await call('POST', `/focus-queue/${q[0].id}/move`, { index: 0 }, { mode: two, expect: 400 });
    expect(await queue(one)).toHaveLength(1);
  });

  it('refuses while the flag is off', async () => {
    const mode = await fresh();
    const { card } = await setup(mode);
    const [item] = await add(mode, { task_id: card.id });
    await call('PUT', '/features/focus-queue', { enabled: false }, { mode });
    await call('GET', '/focus-queue', undefined, { mode, expect: 404 });
    await call('POST', '/focus-queue', { task_id: card.id }, { mode, expect: 404 });
    await call('DELETE', `/focus-queue/${item.id}`, undefined, { mode, expect: 404 });
    await call('POST', `/focus-queue/${item.id}/move`, { index: 0 }, { mode, expect: 404 });
    expect(await toolError('get_focus_queue', { mode })).toMatch(/turned off|focus-queue/);
    await call('PUT', '/features/focus-queue', { enabled: true }, { mode });
    expect(await queue(mode)).toHaveLength(1);
  });

  it('Claude reads and changes it', async () => {
    const mode = await fresh();
    const { card, a, b } = await setup(mode);
    let q = await tool('add_to_focus_queue', { task_id: card.id, mode });
    q = await tool('add_to_focus_queue', { task_id: a.id, mode });
    q = await tool('add_to_focus_queue', { task_id: b.id, now: true, mode });
    expect(titles(q)).toEqual(['Call Sam', 'Fix roof', 'Buy nails']);
    q = await tool('move_in_focus_queue', { id: q[0].id, index: 1, mode });
    expect(titles(q)).toEqual(['Fix roof', 'Call Sam', 'Buy nails']);
    q = await tool('remove_from_focus_queue', { task_id: a.id, mode });
    expect(titles(q)).toEqual(['Fix roof', 'Call Sam']);
    q = await tool('remove_from_focus_queue', { id: q[0].id, mode });
    expect(titles(q)).toEqual(['Call Sam']);
    expect(titles(await tool('get_focus_queue', { mode }))).toEqual(['Call Sam']);
    expect(await toolError('remove_from_focus_queue', { mode })).toMatch(/id or task_id/);
    // Every change is one undo step.
    await call('POST', '/undo', undefined, { mode });
    expect(titles(await queue(mode))).toEqual(['Fix roof', 'Call Sam']);
    await call('POST', '/undo', undefined, { mode });
    expect(titles(await queue(mode))).toEqual(['Fix roof', 'Call Sam', 'Buy nails']);
    await call('POST', '/undo', undefined, { mode });
    expect(titles(await queue(mode))).toEqual(['Call Sam', 'Fix roof', 'Buy nails']);
  });
});
