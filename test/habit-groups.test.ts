import { describe, expect, it } from 'vitest';
import { call } from './helpers';
import { groupByCategory, isFlat, NO_CATEGORY, type GroupCategory } from '../src/core/habit-groups';

const categories: GroupCategory[] = [
  { id: 'health', label: 'Health', color: 'green' },
  { id: 'home', label: 'Home', color: 'red' },
];
const habit = (id: string, category_id: string | null) => ({ id, category_id });
const group = (items: ReturnType<typeof habit>[]) => groupByCategory(items, (h) => h.category_id, categories);

describe('habit category groups', () => {
  it('follows the categories’ order, keeps each group’s order and puts No category last', () => {
    const groups = group([habit('a', null), habit('b', 'home'), habit('c', 'health'), habit('d', 'home')]);
    expect(groups.map((g) => [g.label, g.items.map((h) => h.id)])).toEqual([
      ['Health', ['c']],
      ['Home', ['b', 'd']],
      ['No category', ['a']],
    ]);
  });

  it('treats a category that is gone as No category', () => {
    expect(group([habit('a', 'deleted')]).map((g) => g.id)).toEqual([NO_CATEGORY]);
  });

  it('is flat only when no habit has a category', () => {
    expect(isFlat(group([habit('a', null)]))).toBe(true);
    expect(isFlat(group([habit('a', null), habit('b', 'home')]))).toBe(false);
  });
});

describe('habit groups in /api/status (widget and menu bar)', () => {
  it('is empty until a habit has a category, then lists today’s habits by category', async () => {
    const m = { mode: (await call('POST', '/modes', { label: `Habit groups ${Math.random().toString(36).slice(2, 8)}` })).id as string };
    const run = await call('POST', '/habits', { name: 'Run', sessions: 1, per: 'day' }, m);
    const stretch = await call('POST', '/habits', { name: 'Stretch', sessions: 1, per: 'day' }, m);
    expect((await call('GET', '/status', undefined, m)).habit_groups).toEqual([]);
    const health = await call('POST', '/categories', { label: 'Health', color: 'green' }, m);
    await call('PATCH', `/habits/${stretch.id}`, { category_id: health.id }, m);
    expect((await call('GET', '/status', undefined, m)).habit_groups).toEqual([
      { id: health.id, label: 'Health', habit_ids: [stretch.id] },
      { id: 'none', label: 'No category', habit_ids: [run.id] },
    ]);
  });
});
