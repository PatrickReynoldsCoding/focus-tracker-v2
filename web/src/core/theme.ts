// The theme: Same as computer (default), Light, Dark or E-ink. Kept per device in localStorage
// ('ft.theme') and applied before the first paint by a small script in index.html, which sets
// data-theme on <html> (no attribute = follow the computer). This module keeps that attribute
// up to date, and tells the rest of the app which look is on screen (resolvedTheme), so that
// behaviour can change too (E-ink: a timer that ticks once a minute, no auto-rotating lists).

import { signal, useSignal } from './signal';

export type ThemeChoice = 'system' | 'light' | 'dark' | 'eink';
export type Look = 'light' | 'dark' | 'eink';

export const THEMES: { id: ThemeChoice; label: string; hint: string }[] = [
  { id: 'system', label: 'Same as computer', hint: 'Light or dark, as this device is set' },
  { id: 'light', label: 'Light', hint: 'Always light' },
  { id: 'dark', label: 'Dark', hint: 'Always dark' },
  { id: 'eink', label: 'E-ink', hint: 'Black on white, thick borders, patterns for colours, no motion. For e-ink screens.' },
];

const KEY = 'ft.theme';
const BAR = { light: '#f6f5f1', dark: '#151514', eink: '#ffffff' };

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'eink' ? v : 'system';
  } catch {
    return 'system';
  }
}

const query = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const resolve = (c: ThemeChoice): Look => (c === 'system' ? (query?.matches ? 'dark' : 'light') : c);

export const themeChoice = signal<ThemeChoice>(read());
/** What is on screen now: 'system' resolved to light or dark. */
export const resolvedTheme = signal<Look>(resolve(themeChoice.value));
export const isEink = () => resolvedTheme.value === 'eink';
export const useLook = () => useSignal(resolvedTheme);
export const useEink = () => useSignal(resolvedTheme) === 'eink';

function apply() {
  const c = themeChoice.value;
  const el = document.documentElement;
  if (c === 'system') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', c);
  resolvedTheme.value = resolve(c);
  // The browser's address bar colour follows the look.
  for (const m of Array.from(document.querySelectorAll('meta[name="theme-color"]'))) m.setAttribute('content', BAR[resolvedTheme.value]);
}

export function setTheme(c: ThemeChoice): void {
  themeChoice.value = c;
  try {
    if (c === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, c);
  } catch {
    /* private mode or blocked storage: the choice lasts until the page closes */
  }
  apply();
}

// "Same as computer" follows the computer while the app is open, too.
query?.addEventListener?.('change', () => themeChoice.value === 'system' && apply());
if (typeof document !== 'undefined') apply();
