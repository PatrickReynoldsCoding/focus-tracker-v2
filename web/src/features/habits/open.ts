// Which habit's dialog is open (D56). Any screen opens one with openHabit(id): the overlay in
// HabitDialog.tsx draws it over the page, so a name in any panel opens the same dialog.
import { signal } from '../../core/signal';

export const openHabitId = signal<string | null>(null);

export const openHabit = (id: string) => {
  openHabitId.value = id;
};

/** The first line of a habit's notes, as plain-ish text for a tooltip. */
export const firstLine = (notes: string | null | undefined) =>
  (notes ?? '')
    .split('\n')
    .map((l) => l.replace(/^[\s#>*+-]+|\[[ xX]\]\s*/g, '').trim())
    .find(Boolean) ?? '';
