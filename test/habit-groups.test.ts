import { describe, expect, it } from 'vitest';
import { groupByCategory, isFlat, NO_CATEGORY, type GroupCategory } from '../web/src/features/habits/groups';

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
