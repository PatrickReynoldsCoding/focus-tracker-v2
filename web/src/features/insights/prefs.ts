// Per-device choices (sub-tab, ranges), kept in localStorage. Storage can be blocked: every access is guarded.
import { useEffect, useState } from 'preact/hooks';
import { get, HttpError, mode, version } from '../../core/api';
import { useSignal } from '../../core/signal';

const KEY = 'ft.insights.';

export function readPref(name: string): string | null {
  try {
    return localStorage.getItem(KEY + name);
  } catch {
    return null;
  }
}
export function writePref(name: string, value: string): void {
  try {
    localStorage.setItem(KEY + name, value);
  } catch {
    /* blocked: the choice just is not remembered */
  }
}

/** A choice from a fixed list, remembered on this device. */
export function usePref<T extends string | number>(name: string, options: readonly T[], fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const saved = readPref(name);
    return options.find((o) => String(o) === saved) ?? fallback;
  });
  return [
    value,
    (v: T) => {
      setValue(v);
      writePref(name, String(v));
    },
  ];
}

/** Last answers by mode and path, so a sub-tab shows its old numbers at once while the new ones load. */
const cache = new Map<string, unknown>();

export function useInsights<T>(path: string): { data: T | undefined; error: string | null } {
  const v = useSignal(version);
  const m = useSignal(mode);
  const key = `${m}\u0000${path}`;
  const [, redraw] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    get<T>(path)
      .then((d) => {
        cache.set(key, d);
        if (live) (setError(null), redraw((n) => n + 1));
      })
      .catch((e: Error) => live && !(e instanceof HttpError && e.status === 401) && setError(e.message));
    return () => {
      live = false;
    };
  }, [key, v]);
  const data = cache.get(key) as T | undefined;
  return { data, error: data === undefined ? error : null };
}
