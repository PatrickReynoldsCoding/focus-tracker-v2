// A panel's small ("mobile") version. A panel that is narrow (a phone, or a panel made small on a
// computer) draws `small` instead of its full self; the same small version is what a widget shows.
// It watches its own width, so resizing a panel switches it with no help from the layout.

import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

/** Narrower than this (in px), a panel shows its small version. About a phone's width, so a phone shows them all. */
export const SMALL_PANEL_PX = 420;

export function Adaptive({ small, children }: { small: () => ComponentChildren; children: ComponentChildren }) {
  const box = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width > 0 && entry.contentRect.width < SMALL_PANEL_PX));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  return (
    <div ref={box} class={`panel-adaptive${narrow ? ' is-small' : ''}`}>
      {narrow ? small() : children}
    </div>
  );
}
