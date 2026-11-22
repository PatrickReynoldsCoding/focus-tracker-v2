// Subtasks (D57): a checklist on a card or to-do, one level, in a table of their own.
import { describe, expect, it } from 'vitest';
import { call, tool, toolError } from './helpers';

let n = 0;
async function fresh() {
  const m = await call('POST', '/modes', { label: `Sub ${++n} ${Math.random().toString(36).slice(2, 6)}` });
  return { mode: m.id as string };
}
async function todoWith(mode: string, titles: string[] = []) {
  const todo = await call('POST', '/todos', { title: 'Plan the launch' }, { mode });
  const subs = [];
  for (const title of titles) subs.push(await call('POST', '/subtasks', { task_id: todo.id, title }, { mode }));
  return { todo, subs };
}
const board = (mode: string, listId: string) => call('GET', `/boards/list/${listId}`, undefined, { mode });
const cardOf = async (mode: string, listId: string, id: string) => (await board(mode, listId)).flatMap((c: any) => c.cards).find((c: any) => c.id === id);

describe('subtasks', () => {
  it('are in the board answer, in order, and tick without touching the parent', async () => {
    const { mode } = await fresh();
    const { todo, subs } = await todoWith(mode, ['Write', 'Book', 'Send']);
    let card = await cardOf(mode, todo.list_id, todo.id);
    expect(card.subtasks.map((s: any) => [s.title, s.done])).toEqual([['Write', null], ['Book', null], ['Send', null]]);
    for (const s of subs) await call('POST', `/subtasks/${s.id}/tick`, { done: true }, { mode });
    card = await cardOf(mode, todo.list_id, todo.id);
    expect(card.subtasks.every((s: any) => s.done)).toBe(true);
    expect(card.done).toBeNull(); // all ticked, the to-do is not
    // Ticking the parent leaves the subtasks alone.
    await call('POST', `/todos/${todo.id}/tick`, { done: true }, { mode });
    await call('POST', `/subtasks/${subs[0].id}/tick`, { done: false }, { mode });
    card = await cardOf(mode, todo.list_id, todo.id);
    expect(card.done).not.toBeNull();
    expect(card.subtasks.map((s: any) => !!s.done)).toEqual([false, true, true]);
    await call('POST', `/todos/${todo.id}/tick`, { done: false }, { mode });
    expect((await cardOf(mode, todo.list_id, todo.id)).subtasks.map((s: any) => !!s.done)).toEqual([false, true, true]);
  });

  it('can be edited, reordered and deleted; deleting the parent deletes them and undo brings them back', async () => {
    const { mode } = await fresh();
    const { todo, subs } = await todoWith(mode, ['A', 'B', 'C']);
    await call('PATCH', `/subtasks/${subs[0].id}`, { title: 'A2' }, { mode });
    await call('POST', `/subtasks/${subs[2].id}/move`, { index: 0 }, { mode });
    expect((await cardOf(mode, todo.list_id, todo.id)).subtasks.map((s: any) => s.title)).toEqual(['C', 'A2', 'B']);
    await call('DELETE', `/subtasks/${subs[1].id}`, undefined, { mode });
    expect((await cardOf(mode, todo.list_id, todo.id)).subtasks.map((s: any) => s.title)).toEqual(['C', 'A2']);
    await call('DELETE', `/todos/${todo.id}`, undefined, { mode });
    const left = await call('GET', '/subtasks', undefined, { mode });
    expect(left).toEqual([]);
    await call('POST', '/undo', undefined, { mode });
    expect((await cardOf(mode, todo.list_id, todo.id)).subtasks.map((s: any) => s.title)).toEqual(['C', 'A2']);
  });

  it('are not cards, not on Today alone, and follow the parent there as a count', async () => {
    const { mode } = await fresh();
    const { todo, subs } = await todoWith(mode, ['A', 'B']);
    await call('PATCH', `/todos/${todo.id}`, { day: '2000-01-01' }, { mode });
    await call('POST', `/subtasks/${subs[0].id}/tick`, { done: true }, { mode });
    const t = await call('GET', '/today', undefined, { mode });
    expect(t.todos.map((x: any) => x.id)).toEqual([todo.id]);
    expect(t.subtasks).toEqual({ [todo.id]: [1, 2] });
    const l = await call('GET', '/today/list', undefined, { mode });
    expect(l.items.map((x: any) => x.id)).toEqual([todo.id]);
    expect(l.items[0].subtasks).toEqual([1, 2]);
    expect((await call('GET', '/todos', undefined, { mode })).map((x: any) => x.id)).toEqual([todo.id]);
  });

  it('are one level only: a subtask cannot be a parent', async () => {
    const { mode } = await fresh();
    const { subs } = await todoWith(mode, ['A']);
    await call('POST', '/subtasks', { task_id: subs[0].id, title: 'deeper' }, { mode, expect: 400 });
  });

  it('Claude adds and ticks them, on to-dos and cards, by profile name', async () => {
    const { mode } = await fresh();
    const todo = await tool('add_todo', { title: 'Trip', subtasks: ['Tickets', 'Hotel'], mode });
    expect(todo.subtasks.map((s: any) => s.title)).toEqual(['Tickets', 'Hotel']);
    const more = await tool('add_subtask', { task_id: todo.id, titles: ['Bags'], mode });
    expect(more).toHaveLength(1);
    const first = await tool('tick_subtask', { id: todo.subtasks[0].id, mode });
    expect(first.done).toBeTruthy();
    const b = await tool('get_board', { list_id: todo.list_id, mode });
    const card = b.flatMap((c: any) => c.cards).find((c: any) => c.id === todo.id);
    expect(card.subtasks.map((s: any) => [s.title, !!s.done])).toEqual([['Tickets', true], ['Hotel', false], ['Bags', false]]);
    expect(card.done).toBeNull();
    // A card on a project board.
    const p = await call('POST', '/projects', { name: 'P' }, { mode });
    const c = await tool('add_card', { project_id: p.id, title: 'Card', subtasks: ['x'], mode });
    expect(c.subtasks).toHaveLength(1);
    const u = await tool('update_card', { id: c.id, add_subtasks: ['y'], mode });
    expect(u.subtasks.map((s: any) => s.title)).toEqual(['y']);
    expect(await toolError('add_subtask', { task_id: c.id, mode })).toMatch(/title/);
  });

  it('are hidden and refused while the flag is off, and kept', async () => {
    const { mode } = await fresh();
    const { todo } = await todoWith(mode, ['A']);
    await call('PUT', '/features/subtasks', { enabled: false }, { mode });
    expect((await cardOf(mode, todo.list_id, todo.id)).subtasks).toBeUndefined();
    await call('POST', '/subtasks', { task_id: todo.id, title: 'B' }, { mode, expect: 404 });
    expect(await toolError('add_todo', { title: 'X', subtasks: ['a'], mode })).toMatch(/subtasks/i);
    await call('PUT', '/features/subtasks', { enabled: true }, { mode });
    expect((await cardOf(mode, todo.list_id, todo.id)).subtasks).toHaveLength(1);
  });

  it('"open by default" is a setting for a profile or all, on unless set', async () => {
    const { mode } = await fresh();
    const states = await call('GET', '/setting-scope', undefined, { mode });
    expect(states.find((s: any) => s.id === 'subtasks.open_default')).toBeTruthy();
    await call('PUT', '/settings/subtasks.open_default', { value: 'off' }, { mode });
    expect((await call('GET', '/settings', undefined, { mode })).mode['subtasks.open_default']).toBe('off');
    await call('PUT', '/settings/subtasks.open_default', { value: 'nope' }, { mode, expect: 400 });
  });
});
