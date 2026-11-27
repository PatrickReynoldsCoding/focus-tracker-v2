// Keeps the Desktop page up to date. Its window sits behind the others and never becomes "visible
// again", so the Today list's "back to the front" refresh (features/today-list/index.tsx) never runs
// there. Instead, while the page is open: reload everything (bump `version`) every minute and when the
// window gets focus, unless the user is typing in a field or a dialog or the editor is open, so nothing
// they type is lost. One refresh at a time: a second one within 5 seconds of the last is skipped.

import { useEffect } from 'preact/hooks';
import { version } from '../../core/api';

const EVERY = 60_000;
const MIN_GAP = 5_000;

declare global {
  interface Window {
    /** Test hook: the Desktop page's refresh interval in milliseconds. */
    __ftDesktopRefreshMs?: number;
  }
}

/** Whether the user is in the middle of something a reload could disturb. */
export function busy(): boolean {
  const a = document.activeElement as HTMLElement | null;
  if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return true;
  if (document.querySelector('dialog[open]')) return true;
  const s = history.state;
  return !!(s && (s.dialog || s.editor || s.arrange));
}

export function useKeepDesktopFresh() {
  useEffect(() => {
    let last = Date.now();
    const refresh = () => {
      if (busy() || Date.now() - last < MIN_GAP) return;
      last = Date.now();
      version.value++;
    };
    const timer = window.setInterval(refresh, window.__ftDesktopRefreshMs ?? EVERY);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);
}
