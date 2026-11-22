// Whether a card's subtasks are shown (D57): the profile's setting "Subtasks open by default"
// (on unless set), until this device has opened or folded that card, which it then remembers
// (`ft.subs.<card id>`). The setting is loaded once for every card on screen, again after a change
// lands or the profile changes.
import { useEffect } from 'preact/hooks';
import { get, localStorageSet, mode } from '../../core/api';
import { signal, useSignal } from '../../core/signal';

type Settings = { global: Record<string, string>; mode: Record<string, string> };
export const OPEN_SETTING = 'subtasks.open_default';

const openByDefault = signal<{ mode: string; on: boolean } | null>(null);
const remembered = signal(0);
let loaded: string | null = null;

function load(m: string) {
  if (loaded === m) return;
  loaded = m;
  const key = m;
  get<Settings>('/settings')
    .then((s) => {
      if (m === mode.value) openByDefault.value = { mode: m, on: (s.mode[OPEN_SETTING] ?? s.global[OPEN_SETTING] ?? 'on') !== 'off' };
    })
    .catch(() => {
      if (loaded === key) loaded = null;
    });
}

/** Read the setting again (after Settings changed it). */
export function reloadOpenDefault() {
  loaded = null;
  load(mode.value);
}

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

/** Whether this card's subtasks are shown, and how to show or fold them (remembered on this device). */
export function useSubtasksOpen(cardId: string): [boolean, (open: boolean) => void] {
  const m = useSignal(mode);
  const d = useSignal(openByDefault);
  useSignal(remembered);
  useEffect(() => load(m), [m]);
  const key = `ft.subs.${cardId}`;
  const own = read(key);
  const fallback = d?.mode === m ? d.on : true;
  const open = own === '1' ? true : own === '0' ? false : fallback;
  return [
    open,
    (on) => {
      localStorageSet(key, on ? '1' : '0');
      remembered.value++;
    },
  ];
}
