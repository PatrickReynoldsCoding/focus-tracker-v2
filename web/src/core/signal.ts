// A tiny signal: a value plus subscribers, and a hook to re-render on change.
import { useEffect, useState } from 'preact/hooks';

export interface Signal<T> {
  value: T;
  subscribe(fn: (v: T) => void): () => void;
}

export function signal<T>(initial: T): Signal<T> {
  let v = initial;
  const subs = new Set<(v: T) => void>();
  return {
    get value() {
      return v;
    },
    set value(next: T) {
      if (Object.is(next, v)) return;
      v = next;
      for (const s of [...subs]) s(v);
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export function useSignal<T>(s: Signal<T>): T {
  const [, set] = useState(0);
  const seen = s.value;
  useEffect(() => {
    const off = s.subscribe(() => set((n) => n + 1));
    // It may have changed between this render and now (another component's effect set it).
    if (!Object.is(s.value, seen)) set((n) => n + 1);
    return off;
  }, [s]);
  return seen;
}
