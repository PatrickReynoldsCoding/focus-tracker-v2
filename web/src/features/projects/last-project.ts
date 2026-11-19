// The project last open on the Projects tab, remembered per device and mode.
import { localStorageSet, mode } from '../../core/api';

const key = () => `ft.lastProject.${mode.value}`;

export const lastProject = {
  get(): string | null {
    try {
      return localStorage.getItem(key()) || null;
    } catch {
      return null;
    }
  },
  set(id: string) {
    localStorageSet(key(), id);
  },
  /** Forget it (all, or only if it is this project). */
  clear(onlyId?: string) {
    if (onlyId && this.get() !== onlyId) return;
    localStorageSet(key(), '');
  },
};
