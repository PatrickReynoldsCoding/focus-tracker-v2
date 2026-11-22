// What a device remembers about a board (D41): its view (Board or List), for each project and
// to-do, and a to-do's Hide done (a project's Hide done is saved on the server, D34).

import { useState } from 'preact/hooks';
import { localStorageSet } from '../../core/api';
import type { View } from './model';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** A value kept on this device under `key`, with `fallback` until it is set. */
export function useRemembered<T extends string>(key: string, fallback: T, parse: (v: string) => T | null): [T, (v: T) => void] {
  const [value, setValue] = useState<{ key: string; v: T }>(() => ({ key, v: parse(read(key) ?? '') ?? fallback }));
  // Another board on the same screen (a new key): read its own value.
  const now = value.key === key ? value.v : (parse(read(key) ?? '') ?? fallback);
  const set = (v: T) => {
    setValue({ key, v });
    localStorageSet(key, v);
  };
  return [now, set];
}

/** The board's view on this device (`ft.view.<board>`). */
export const useView = (board: string, fallback: View) => useRemembered<View>(`ft.view.${board}`, fallback, (v) => (v === 'board' || v === 'list' ? v : null));

/** A to-do's Hide done on this device (`ft.hide-done.<list id>`); folded until opened. */
export function useLocalHideDone(listId: string): [boolean, (hide: boolean) => void] {
  const [v, set] = useRemembered<'1' | '0'>(`ft.hide-done.${listId}`, '1', (x) => (x === '1' || x === '0' ? x : null));
  return [v === '1', (hide) => set(hide ? '1' : '0')];
}

/** A list's group folded on this device (`ft.gfold.<column id>`, D58); open until folded. */
export function useGroupFold(columnId: string): [boolean, (fold: boolean) => void] {
  const [v, set] = useRemembered<'1' | '0'>(`ft.gfold.${columnId}`, '0', (x) => (x === '1' || x === '0' ? x : null));
  return [v === '1', (fold) => set(fold ? '1' : '0')];
}
