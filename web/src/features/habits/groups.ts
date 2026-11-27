// Habits in category groups: which habit belongs where. Categories keep their own order,
// "No category" is last, and each group keeps the order the list came in.
export const NO_CATEGORY = 'none';

export type GroupCategory = { id: string; label: string; color: string | null };
export type Group<T> = { id: string; label: string; color: string | null; items: T[] };

/** With no category on any item there is one group, `NO_CATEGORY`, which is drawn with no heading. */
export function groupByCategory<T>(items: T[], categoryOf: (item: T) => string | null | undefined, categories: GroupCategory[]): Group<T>[] {
  const known = new Set(categories.map((c) => c.id));
  const idOf = (item: T) => {
    const id = categoryOf(item);
    return id && known.has(id) ? id : NO_CATEGORY;
  };
  const all = [...categories, { id: NO_CATEGORY, label: 'No category', color: null }];
  return all.map((c) => ({ id: c.id, label: c.label, color: c.color, items: items.filter((x) => idOf(x) === c.id) })).filter((g) => g.items.length);
}

export const isFlat = (groups: { id: string }[]) => groups.every((g) => g.id === NO_CATEGORY);
