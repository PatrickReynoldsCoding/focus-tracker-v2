// Category buttons (flag category-buttons, D42): a row of big rounded coloured buttons above the
// Projects list, one per category with its project count, plus All. Tap one to show only that
// category, tap it again (or All) to clear. The Projects tab owns the choice; this draws it.
import { localStorageSet, mode } from '../../core/api';
import './category-buttons.css';

export const FLAG = 'category-buttons';
export const NONE = '__none';
export type Cat = { id: string; label: string; color: string | null };

const key = () => `ft.category-button.${mode.value}`;
export const loadChoice = (): string => {
  try {
    return localStorage.getItem(key()) ?? '';
  } catch {
    return '';
  }
};
export const saveChoice = (v: string) => localStorageSet(key(), v);

/** White or black text for a #rrggbb colour. */
export function inkFor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return l > 0.4 ? '#000' : '#fff';
}
export const HEX = /^#[0-9a-f]{6}$/i;

/** The strong button colours (category-buttons.css), in the order the colour picker shows them. */
export const PALETTE = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'grey'];

export function CategoryButtons({ cats, counts, noneCount, total, value, onPick }: { cats: Cat[]; counts: Record<string, number>; noneCount: number; total: number; value: string; onPick: (id: string) => void }) {
  // A category with no projects in the list is hidden, except the chosen one (so it can be cleared).
  const shown = cats.filter((c) => counts[c.id] || c.id === value);
  const pick = (id: string) => onPick(value === id ? '' : id);
  const btn = (id: string, label: string, n: number, color: string | null) => {
    const hex = color && HEX.test(color) ? color : null;
    const on = id === '' ? !value : value === id;
    return (
      <button
        key={id || 'all'}
        type="button"
        class={`cat-btn ${on ? 'on' : ''} ${value && !on ? 'dim' : ''}`}
        data-color={hex ? 'custom' : color || 'none'}
        style={hex ? { '--kb': hex, '--kb-fg': inkFor(hex) } : undefined}
        aria-pressed={on}
        onClick={() => (id === '' ? onPick('') : pick(id))}
      >
        {on && id !== '' && <span aria-hidden="true">✓ </span>}
        <span class="cat-btn-name">{label}</span>
        <span class="cat-btn-n">{n}</span>
      </button>
    );
  };
  return (
    <div class="cat-buttons" role="group" aria-label="Filter projects by category">
      {btn('', 'All', total, null)}
      {shown.map((c) => btn(c.id, c.label, counts[c.id] ?? 0, c.color))}
      {(noneCount > 0 || value === NONE) && btn(NONE, 'No category', noneCount, null)}
    </div>
  );
}
