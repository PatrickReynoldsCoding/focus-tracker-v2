// Habits grouped by category with headings that fold, wherever habits are listed. A folded group
// keeps its count. Each device remembers what is folded, per profile and per place.
import type { ComponentChildren } from 'preact';
import { localStorageSet, mode } from '../../core/api';
import { useFlag } from '../../core/features';
import { signal, useSignal } from '../../core/signal';
import { useData } from '../../core/ui';
import { HEX, PALETTE } from '../category-buttons/CategoryButtons';
import { groupByCategory, isFlat, type Group, type GroupCategory } from './groups';
import './groups.css';

const foldChanges = signal(0);
const foldKey = (place: string, categoryId: string) => `ft.habit-fold.${mode.value}.${place}.${categoryId}`;

function isFolded(key: string) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function setFolded(key: string, folded: boolean) {
  localStorageSet(key, folded ? '1' : '0');
  foldChanges.value++;
}

type HabitCategory = { id: string; category_id: string | null };

/** The groups for a list of habits (or rows about habits); `habitId` says which habit an item is. */
export function useHabitGroups<T>(items: T[], habitId: (item: T) => string): Group<T>[] {
  // Nothing to group asks for nothing: with the Habits feature off the server refuses /habits.
  // A saved copy of a page can still list habits after the feature is switched off.
  const wanted = useFlag('habits') && items.length > 0;
  const { data: categories } = useData<GroupCategory[]>(wanted ? '/categories' : null);
  const { data: habits } = useData<HabitCategory[]>(wanted ? '/habits' : null);
  const categoryByHabit = new Map(habits?.map((h) => [h.id, h.category_id]));
  return groupByCategory(items, (x) => categoryByHabit.get(habitId(x)), categories ?? []);
}

function Swatch({ color }: { color: string | null }) {
  if (color && HEX.test(color)) return <span class="hg-swatch" style={{ background: color }} aria-hidden="true" />;
  const name = color && PALETTE.includes(color) ? color : 'grey';
  return <span class={`hg-swatch c-${name}`} data-color={name} aria-hidden="true" />;
}

function Heading<T>({ group, folded, onToggle, summary }: { group: Group<T>; folded: boolean; onToggle: () => void; summary: string }) {
  return (
    <button type="button" class="hg-head" aria-expanded={!folded} onClick={onToggle}>
      <span class="hg-chevron" aria-hidden="true">
        {folded ? '▸' : '▾'}
      </span>
      <Swatch color={group.color} />
      <span class="hg-label">{group.label}</span>
      <span class="hg-summary">{summary}</span>
    </button>
  );
}

type GroupsProps<T> = {
  /** Which screen this is: folding here does not fold the same category elsewhere. */
  place: string;
  items: T[];
  habitId: (item: T) => string;
  /** What the heading shows on the right, e.g. "1/2". */
  summary?: (items: T[]) => string;
  children: (items: T[]) => ComponentChildren;
};

const howMany = <T,>(items: T[]) => String(items.length);

export function HabitGroups<T>({ place, items, habitId, summary = howMany, children }: GroupsProps<T>) {
  useSignal(foldChanges);
  const groups = useHabitGroups(items, habitId);
  if (isFlat(groups)) return <>{children(items)}</>;
  return (
    <div class="hg">
      {groups.map((g) => {
        const key = foldKey(place, g.id);
        const folded = isFolded(key);
        return (
          <div class="hg-group" key={g.id} role="group" aria-label={g.label}>
            <Heading group={g} folded={folded} onToggle={() => setFolded(key, !folded)} summary={summary(g.items)} />
            {!folded && children(g.items)}
          </div>
        );
      })}
    </div>
  );
}

/** The same groups as table bodies: a heading row, then the group's rows. */
export function HabitTableBodies<T>({ place, items, habitId, columns, row }: { place: string; items: T[]; habitId: (item: T) => string; columns: number; row: (item: T) => ComponentChildren }) {
  useSignal(foldChanges);
  const groups = useHabitGroups(items, habitId);
  if (isFlat(groups)) return <tbody>{items.map(row)}</tbody>;
  return (
    <>
      {groups.map((g) => {
        const key = foldKey(place, g.id);
        const folded = isFolded(key);
        return (
          <tbody key={g.id}>
            <tr class="hg-row">
              <th colSpan={columns} scope="colgroup">
                <Heading group={g} folded={folded} onToggle={() => setFolded(key, !folded)} summary={howMany(g.items)} />
              </th>
            </tr>
            {!folded && g.items.map(row)}
          </tbody>
        );
      })}
    </>
  );
}
