// Panel restyle (D49): the flag, and what the web app's plain-list List view and the panels' drag
// rely on: a plain list's board on Today with its columns, items moved between columns and
// reordered with an index, no Done column and no ticks.
import { describe, expect, it } from 'vitest';
import { call } from './helpers';

let n = 0;
async function fresh() {
  const m = await call('POST', '/modes', { label: `Restyle ${++n} ${Math.random().toString(36).slice(2, 6)}` });
  return { mode: m.id as string };
}
const titles = (cols: any[]) => cols.map((c: any) => [c.name, c.cards.map((x: any) => x.title)]);

describe('panel restyle', () => {
  it('has the flag panel-restyle, on by default, switchable per profile', async () => {
    const m = await fresh();
    const find = async () => (await call('GET', '/features', undefined, m)).find((x: any) => x.id === 'panel-restyle');
    expect(await find()).toMatchObject({ enabled: true, label: 'Slim panels' });
    await call('PUT', '/features/panel-restyle', { enabled: false }, m);
    expect((await find()).enabled).toBe(false);
    expect((await call('GET', '/features')).find((x: any) => x.id === 'panel-restyle').enabled).toBe(true);
  });

  it('gives a plain list’s panel its groups, and moves items between them and within one', async () => {
    const m = await fresh();
    const l = await call('POST', '/lists', { name: 'Books', kind: 'list', show_today: true }, m);
    const [items] = (await call('GET', `/lists/${l.id}/full`, undefined, m)).columns;
    const later = await call('POST', '/columns', { list_id: l.id, name: 'Later' }, m);
    const a = await call('POST', '/tasks', { title: 'Dune', column_id: items.id }, m);
    const b = await call('POST', '/tasks', { title: 'Emma', column_id: items.id }, m);
    await call('POST', '/tasks', { title: 'Ulysses', column_id: later.id }, m);
    const panel = (await call('GET', '/today-panels', undefined, m)).find((x: any) => x.key === `list:${l.id}`);
    expect(titles(panel.columns)).toEqual([['Items', ['Dune', 'Emma']], ['Later', ['Ulysses']]]);
    expect(panel.columns.some((c: any) => c.is_done)).toBe(false);
    // Reorder within a group, then move into another group at a place.
    await call('POST', `/tasks/${b.id}/move`, { column_id: items.id, index: 0 }, m);
    await call('POST', `/tasks/${a.id}/move`, { column_id: later.id, index: 0 }, m);
    const full = await call('GET', `/lists/${l.id}/full`, undefined, m);
    expect(titles(full.columns)).toEqual([['Items', ['Emma']], ['Later', ['Dune', 'Ulysses']]]);
    expect(full.kind).toBe('list');
    expect(full.columns.flatMap((c: any) => c.cards).every((x: any) => !x.day)).toBe(true);
  });
});
