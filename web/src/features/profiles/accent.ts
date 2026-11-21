// The accent colour of the open profile is applied to the whole app (CSS variable --accent).

import { localStorageSet, mode } from '../../core/api';
import { resolvedTheme } from '../../core/theme';
import { profiles } from '../../core/profiles';

function readable(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? '#10170f' : '#ffffff';
}

/** Mix a #rrggbb colour with white, so a dark accent still reads on a dark background. */
export function lighten(hex: string, amount: number): string {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return '#' + c.map((v) => Math.round(v + (255 - v) * amount).toString(16).padStart(2, '0')).join('');
}

/** A profile's colour as it is shown on this look (lighter on Dark). */
export const shownColour = (hex: string) => (resolvedTheme.value === 'dark' ? lighten(hex, 0.45) : hex);

let current: string | null | undefined;
export function setAccent(color: string | null | undefined) {
  current = color;
  const s = document.documentElement.style;
  if (color && /^#[0-9a-fA-F]{6}$/.test(color)) {
    // On a dark background the profile's colour is lightened until it can be read as text and as a button.
    const shown = shownColour(color);
    s.setProperty('--accent', shown);
    s.setProperty('--accent-fg', readable(shown));
    s.setProperty('--accent-soft', `color-mix(in srgb, ${shown} ${resolvedTheme.value === 'dark' ? 24 : 18}%, var(--surface))`);
  } else {
    for (const p of ['--accent', '--accent-fg', '--accent-soft']) s.removeProperty(p);
  }
  localStorageSet(`ft.accent.${mode.value}`, color ?? '');
}

// Light, Dark or E-ink changed (E-ink ignores the colour in its stylesheet): redo the accent for it.
resolvedTheme.subscribe(() => setAccent(current));

function fromStorage() {
  try {
    setAccent(localStorage.getItem(`ft.accent.${mode.value}`));
  } catch {
    /* no storage */
  }
}
fromStorage();

const fromList = () => {
  const list = profiles.value;
  if (list) setAccent(list.profiles.find((m) => m.id === mode.value)?.color);
};
mode.subscribe(() => {
  fromStorage();
  fromList();
});
profiles.subscribe(fromList);
