// The Today list (D30, flag today-panel): what it gathers (habits, to-dos, cards for today or
// earlier), its order, ticking cards (a project card moves to Done and back), "Not today" for
// habits, the extras on /today and /status, the menu bar, Claude's tools, and the flag off.
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { buildTodayList, habitItem } from '../src/core/today-list';
import { BASE, apiToken, call, mcp, tool } from './helpers';

let n = 0;
/** A fresh mode, so each test starts empty. */
async function fresh() {
  const m = await call('POST', '/modes', { label: `Today list ${++n} ${Math.random().toString(36).slice(2, 6)}` });
  return { mode: m.id as string };
}
const addDays = (day: string, k: number) => new Date(Date.parse(`${day}T12:00:00Z`) + k * 864e5).toISOString().slice(0, 10);
const flag = (on: boolean) => call('PUT', '/features/today-panel', { enabled: on });

describe('the builder (src/core/today-list.ts)', () => {
  const h = { id: 'h', name: 'Run', per: 'week', target: 3, done_today: 0, done_this_period: 1, skipped_today: false };
  it('keeps a weekly habit until the week is met, off for today after a session or Not today', () => {
    expect(habitItem(h)).toMatchObject({ state: 'open', progress: '1/3 wk', can_skip: true });
    expect(habitItem({ ...h, done_today: 1, done_this_period: 2 })).toMatchObject({ state: 'done', progress: '2/3 wk' });
    expect(habitItem({ ...h, skipped_today: true })).toMatchObject({ state: 'skipped' });
    expect(habitItem({ ...h, done_this_period: 3 })).toBeNull();
  });
  it('keeps a daily habit until today’s sessions are done', () => {
    const d = { ...h, per: 'day', target: 3, done_today: 1, done_this_period: 1 };
    expect(habitItem(d)).toMatchObject({ state: 'open', progress: '1/3' });
    expect(habitItem({ ...d, done_today: 3 })).toMatchObject({ state: 'done' });
    expect(habitItem({ ...d, target: 1, done_today: 0 })).toMatchObject({ state: 'open', progress: null });
    expect(habitItem({ ...d, target: null, done_today: 0 })).toMatchObject({ state: 'open' }); // no target: one session
  });
  it('orders habits, then to-dos and cards oldest day first, then what is done', () => {
    const day = '2026-11-19';
    const l = buildTodayList(day, {
      habits: [{ ...h, name: 'Run' }],
      todos: [
        { id: 't1', title: 'Today', day, done: null },
        { id: 't2', title: 'Monday', day: '2026-11-16', done: null },
        { id: 't3', title: 'Anytime', day: null, done: null },
        { id: 't4', title: 'Ticked', day, done: day },
        { id: 't5', title: 'Ticked yesterday', day: '2026-11-17', done: '2026-11-18' },
        { id: 't6', title: 'Tomorrow', day: '2026-11-20', done: null },
      ],
      cards: [
        { id: 'c1', title: 'Card', day: '2026-11-17', done: null },
        { id: 'c2', title: 'In Done', day, done: null, in_last: true },
        { id: 'c3', title: 'Card ticked', day, done: day, in_last: true },
      ],
    });
    expect(l.items.map((x) => x.title)).toEqual(['Run', 'Monday', 'Card', 'Today', 'Ticked', 'Card ticked']);
    expect(l.items.find((x) => x.id === 't2')!.late).toBe('2026-11-16');
    expect([l.left, l.done]).toEqual([4, 2]);
  });
});

describe('GET /api/today/list', () => {
  it('gathers habits, to-dos from every list and cards with a day', async () => {
    const m = await fresh();
    const { day } = await call('GET', '/today', undefined, m);
    const daily = await call('POST', '/habits', { name: 'Stretch', sessions: 2, per: 'day' }, m);
    const weekly = await call('POST', '/habits', { name: 'Swim', sessions: 2, per: 'week' }, m);
    await call('POST', '/habits', { name: 'Someday', status: 'aspiring' }, m);
    const first = await call('POST', '/todos', { title: 'Call plumber', day }, m);
    const other = await call('POST', '/lists', { name: 'Shopping', kind: 'todo' }, m);
    const late = await call('POST', '/todos', { title: 'Milk', list_id: other.id, day: addDays(day, -2) }, m);
    await call('POST', '/todos', { title: 'Anytime', list_id: other.id }, m);
    await call('POST', '/todos', { title: 'Later', day: addDays(day, 3) }, m);
    const p = await call('POST', '/projects', { name: 'Website' }, m);
    const card = await call('POST', '/tasks', { title: 'Fix footer', project_id: p.id, day }, m);
    await call('POST', '/tasks', { title: 'No day', project_id: p.id }, m);
    const plain = await call('POST', '/lists', { name: 'Ideas', kind: 'list' }, m);
    const item = await call('POST', '/tasks', { title: 'Book table', list_id: plain.id, day: addDays(day, -1) }, m);

    const l = await call('GET', '/today/list', undefined, m);
    expect(l.day).toBe(day);
    expect(l.items.map((x: any) => x.title)).toEqual(['Stretch', 'Swim', 'Milk', 'Book table', 'Call plumber', 'Fix footer']);
    expect(l.left).toBe(6);
    const byId = Object.fromEntries(l.items.map((x: any) => [x.id, x]));
    expect(byId[daily.id]).toMatchObject({ kind: 'habit', progress: '0/2', per: 'day' });
    expect(byId[weekly.id]).toMatchObject({ kind: 'habit', progress: '0/2 wk', can_skip: true });
    expect(byId[late.id]).toMatchObject({ kind: 'todo', late: addDays(day, -2), from: 'Shopping', list_id: other.id });
    expect(byId[first.id].from).toBe('To-dos'); // two to-do lists: each to-do says which
    expect(byId[card.id]).toMatchObject({ kind: 'card', from: 'Website', project_id: p.id, late: null });
    expect(byId[item.id]).toMatchObject({ kind: 'card', from: 'Ideas', late: addDays(day, -1) });

    // /today carries the cards for the web panel; /status a short copy for the widget and the menu bar.
    const t = await call('GET', '/today', undefined, m);
    expect(t.cards.map((c: any) => c.id).sort()).toEqual([card.id, item.id].sort());
    expect(Object.values(t.todo_lists).sort()).toEqual(['Shopping', 'To-dos']);
    const s = await call('GET', '/status', undefined, m);
    expect(s.today_list.left).toBe(6);
    expect(s.today_list.items[0]).toEqual({ kind: 'habit', id: daily.id, title: 'Stretch', progress: '0/2', late: null });
  });

  it('ticks a project card into Done and back, and a list item in place', async () => {
    const m = await fresh();
    const { day } = await call('GET', '/today', undefined, m);
    const p = await call('POST', '/projects', { name: 'Garden' }, m);
    const full = await call('GET', `/projects/${p.id}/full`, undefined, m);
    const [todo, , done] = full.columns;
    const card = await call('POST', '/tasks', { title: 'Mow', project_id: p.id, day }, m);
    let c = await call('POST', `/tasks/${card.id}/tick`, { done: true }, m);
    expect([c.column_id, c.done]).toEqual([done.id, day]);
    let l = await call('GET', '/today/list', undefined, m);
    expect(l.items.find((x: any) => x.id === card.id).state).toBe('done');
    c = await call('POST', `/tasks/${card.id}/tick`, { done: false }, m);
    expect([c.column_id, c.done]).toEqual([todo.id, null]);

    // Dragged into Done on the board: done; dragged out: open again.
    c = await call('POST', `/tasks/${card.id}/move`, { column_id: done.id }, m);
    expect(c.done).toBe(day);
    c = await call('POST', `/tasks/${card.id}/move`, { column_id: todo.id }, m);
    expect(c.done).toBeNull();
    // A card with no day is left alone.
    const plainCard = await call('POST', '/tasks', { title: 'No day', project_id: p.id }, m);
    expect((await call('POST', `/tasks/${plainCard.id}/move`, { column_id: done.id }, m)).done).toBeNull();
    // A card already in Done when it gets a day is not in the list.
    await call('PATCH', `/tasks/${plainCard.id}`, { day }, m);
    l = await call('GET', '/today/list', undefined, m);
    expect(l.items.some((x: any) => x.id === plainCard.id)).toBe(false);

    const list = await call('POST', '/lists', { name: 'Errands', kind: 'list' }, m);
    const item = await call('POST', '/tasks', { title: 'Post office', list_id: list.id, day }, m);
    c = await call('POST', `/tasks/${item.id}/tick`, {}, m);
    expect([c.column_id, c.done]).toEqual([item.column_id, day]);
    // Undo takes a tick back (the move and the day together).
    await call('POST', `/tasks/${card.id}/tick`, { done: true }, m);
    await call('POST', '/undo', {}, m);
    c = await call('GET', `/tasks/${card.id}`, undefined, m);
    expect([c.column_id, c.done]).toEqual([todo.id, null]);
  });

  it('puts a habit off for today and back', async () => {
    const m = await fresh();
    const h = await call('POST', '/habits', { name: 'Guitar', sessions: 3, per: 'week' }, m);
    await call('POST', `/habits/${h.id}/not-today`, { on: true }, m);
    await call('POST', `/habits/${h.id}/not-today`, { on: true }, m); // twice is still one skip
    let l = await call('GET', '/today/list', undefined, m);
    expect(l.items[0]).toMatchObject({ id: h.id, state: 'skipped' });
    expect(l.left).toBe(0);
    const p = await call('GET', '/habits/progress', undefined, m);
    expect(p[0]).toMatchObject({ skipped_today: true, left: 0 });
    await call('POST', `/habits/${h.id}/not-today`, { on: false }, m);
    l = await call('GET', '/today/list', undefined, m);
    expect(l.items[0].state).toBe('open');
    await call('POST', `/habits/${h.id}/not-today`, {}, { ...m, expect: 400 });
  });
});

describe('the menu bar and Claude', () => {
  async function menu(mode: string) {
    const res = await SELF.fetch(`${BASE}/api/swiftbar`, { headers: { Authorization: `Bearer ${await apiToken()}`, 'X-Mode': mode } });
    return res.text();
  }
  it('shows the Today list in the menu bar, cards with their own action', async () => {
    const m = await fresh();
    const { day } = await call('GET', '/today', undefined, m);
    await call('POST', '/habits', { name: 'Walk', sessions: 1, per: 'day' }, m);
    const p = await call('POST', '/projects', { name: 'Tax' }, m);
    const card = await call('POST', '/tasks', { title: 'Send return', project_id: p.id, day: addDays(day, -1) }, m);
    const out = await menu(m.mode);
    expect(out).toContain('Today (2 left)');
    expect(out).toContain('○ Walk |');
    expect(out).toContain(`☐ Send return (late) | bash=__SELF__ param1=card param2=${card.id}`);
    const res = await SELF.fetch(`${BASE}/api/swiftbar/action`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await apiToken()}`, 'X-Mode': m.mode, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ action: 'card', id: card.id }),
    });
    expect(res.status).toBe(200);
    expect(await menu(m.mode)).not.toContain('Send return');
  });

  it('lets Claude read and tick the list and give a card a day', async () => {
    const m = await fresh();
    const { day } = await call('GET', '/today', undefined, m);
    const h = await call('POST', '/habits', { name: 'Read', sessions: 2, per: 'week' }, m);
    const todo = await call('POST', '/todos', { title: 'Reply to Sam', day }, m);
    const p = await call('POST', '/projects', { name: 'Car' }, m);
    const card = await call('POST', '/tasks', { title: 'MOT', project_id: p.id }, m);
    let l = await tool('get_today_list', { mode: m.mode });
    expect(l.left).toBe(2);
    await tool('set_card_day', { id: card.id, day, mode: m.mode });
    l = await tool('tick_today_item', { kind: 'todo', id: todo.id, mode: m.mode });
    expect(l.items.find((x: any) => x.id === todo.id).state).toBe('done');
    l = await tool('tick_today_item', { kind: 'card', id: card.id, mode: m.mode });
    expect(l.items.find((x: any) => x.id === card.id).state).toBe('done');
    l = await tool('tick_today_item', { kind: 'habit', id: h.id, not_today: true, mode: m.mode });
    expect(l.items.find((x: any) => x.id === h.id).state).toBe('skipped');
    l = await tool('tick_today_item', { kind: 'habit', id: h.id, not_today: false, mode: m.mode });
    l = await tool('tick_today_item', { kind: 'habit', id: h.id, mode: m.mode });
    expect(l.items.find((x: any) => x.id === h.id)).toMatchObject({ state: 'done', progress: '1/2 wk' });
    expect(l.left).toBe(0);
  });

  it('with the flag off: the old shapes, no list route and no list tools', async () => {
    const m = await fresh();
    const { day } = await call('GET', '/today', undefined, m);
    const p = await call('POST', '/projects', { name: 'Flagged' }, m);
    await call('POST', '/tasks', { title: 'Hidden card', project_id: p.id, day }, m);
    await call('POST', '/todos', { title: 'Old style', day }, m);
    await flag(false);
    try {
      await call('GET', '/today/list', undefined, { ...m, expect: 404 });
      const t = await call('GET', '/today', undefined, m);
      expect(t.cards).toEqual([]);
      expect((await call('GET', '/status', undefined, m)).today_list).toBeNull();
      const out = await menu(m.mode);
      expect(out).toContain('To do today (1)');
      expect(out).not.toContain('Hidden card');
      const names = (await mcp<any>('tools/list')).tools.map((x: any) => x.name);
      expect(names).not.toContain('get_today_list');
      expect(names).not.toContain('tick_today_item');
    } finally {
      await flag(true);
    }
    const names = (await mcp<any>('tools/list')).tools.map((x: any) => x.name);
    expect(names).toEqual(expect.arrayContaining(['get_today_list', 'tick_today_item', 'set_card_day']));
  });
});
