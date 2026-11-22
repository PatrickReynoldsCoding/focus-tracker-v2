// The to-do screen (D41): what the web app's one board component reads from the server. A to-do's
// page and its Today panel get its board (Done last) beside the older groups; a plain list has no
// days; converting answers with the new board; the flag unified-board is on by default.
import { describe, expect, it } from 'vitest';
import { call, toolError } from './helpers';

let n = 0;
async function fresh() {
  const m = await call('POST', '/modes', { label: `Board ${++n} ${Math.random().toString(36).slice(2, 6)}` });
  return { mode: m.id as string };
}

describe('the to-do screen', () => {
  it('gives a to-do its board on its page and on Today, Done last', async () => {
    const m = await fresh();
    const l = await call('POST', '/lists', { name: 'Chores', kind: 'todo', show_today: true }, m);
    const [general] = (await call('GET', `/lists/${l.id}/full`, undefined, m)).columns;
    const group = await call('POST', '/columns', { list_id: l.id, name: 'Later' }, m);
    const a = await call('POST', '/tasks', { title: 'Sweep', column_id: general.id }, m);
    const b = await call('POST', '/tasks', { title: 'Dust', column_id: group.id }, m);
    await call('POST', `/tasks/${a.id}/tick`, { done: true }, m);
    const full = await call('GET', `/lists/${l.id}/full`, undefined, m);
    expect(full.columns.map((c: any) => [c.name, !!c.is_done, c.cards.map((x: any) => x.id)])).toEqual([['General', false, []], ['Later', false, [b.id]], ['Done', true, [a.id]]]);
    expect(full.columns[2].cards[0]).toMatchObject({ from_column_id: general.id, done: expect.any(String) });
    // The older shape stays for anything that reads it.
    expect(full.groups.map((g: any) => g.name)).toEqual(['General', 'Later']);
    const panel = (await call('GET', '/today-panels', undefined, m)).find((x: any) => x.key === `list:${l.id}`);
    expect(panel.columns.map((c: any) => c.name)).toEqual(['General', 'Later', 'Done']);
    // Dragging between groups is a move; into Done ticks it, out again unticks it.
    expect((await call('POST', `/tasks/${b.id}/move`, { column_id: general.id, index: 0 }, m)).column_id).toBe(general.id);
    const done = full.columns[2];
    expect((await call('POST', `/tasks/${b.id}/move`, { column_id: done.id }, m)).done).toBeTruthy();
    expect((await call('POST', `/tasks/${b.id}/move`, { column_id: group.id }, m)).done).toBeNull();
  });

  it('keeps days off a plain list and gives the new board on Convert', async () => {
    const m = await fresh();
    const { day } = await call('GET', '/today', undefined, m);
    const l = await call('POST', '/lists', { name: 'Books', kind: 'list' }, m);
    await call('POST', '/tasks', { title: 'Dune', list_id: l.id, day }, { ...m, expect: 400 });
    const item = await call('POST', '/tasks', { title: 'Dune', list_id: l.id }, m);
    await call('POST', `/tasks/${item.id}/tick`, {}, m); // a plain list's tick only records the day, as before
    expect(await toolError('set_card_day', { id: item.id, day, mode: m.mode })).toContain('to-do');
    await call('PATCH', `/tasks/${item.id}`, { day: null }, m); // no day is fine
    const t = await call('POST', `/lists/${l.id}/convert`, {}, m);
    expect(t.kind).toBe('todo');
    expect(t.columns.map((c: any) => [c.name, !!c.is_done, c.cards.map((x: any) => x.id)])).toEqual([['Items', false, []], ['Done', true, [item.id]]]);
    // A to-do's item can have a day.
    expect((await call('PATCH', `/tasks/${item.id}`, { day }, m)).day).toBe(day);
  });

  it('has the flag unified-board, on by default', async () => {
    const f = (await call('GET', '/features')).find((x: any) => x.id === 'unified-board');
    expect(f).toMatchObject({ enabled: true });
  });
});
