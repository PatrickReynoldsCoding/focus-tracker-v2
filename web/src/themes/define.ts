// Builds a theme from six colours: the rest of its tokens follow from them and from whether it is light or dark.

import type { ThemeDef, ThemeKind } from './types';

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (c: number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
/** `a` moved `amount` (0 to 1) of the way to `b`. */
export const mix = (a: string, b: string, amount: number) => {
  const [x, y] = [rgb(a), rgb(b)];
  return hex(x.map((v, i) => v + (y[i] - v) * amount));
};

const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (h: string) => {
  const [r, g, b] = rgb(h).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG contrast ratio of two #rrggbb colours (1 to 21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

const KIND_VARS: Record<ThemeKind, Record<string, string>> = {
  light: {
    '--warm': '#9a6500', '--danger': '#b3322a', '--danger-fg': '#ffffff', '--ok': '#2e9e5b', '--warn': '#d9a21b',
    '--backdrop': 'rgb(0 0 0 / 0.4)', '--shadow-pop': '0 4px 18px rgb(0 0 0 / 0.14)',
    '--shadow': '0 1px 2px rgb(0 0 0 / 0.05), 0 2px 8px rgb(0 0 0 / 0.04)',
    '--c-red': '#f6d5d1', '--c-orange': '#f8dfc4', '--c-yellow': '#f7edb8', '--c-green': '#d5ecd2', '--c-teal': '#cdeae6',
    '--c-blue': '#d4e2f7', '--c-purple': '#e3d8f3', '--c-pink': '#f5d6e6', '--c-grey': '#e4e4e0',
    'color-scheme': 'light',
  },
  dark: {
    '--warm': '#f0b84a', '--danger': '#ff8a80', '--danger-fg': '#1a0a09', '--ok': '#2e9e5b', '--warn': '#d9a21b',
    '--backdrop': 'rgb(0 0 0 / 0.6)', '--shadow-pop': '0 4px 18px rgb(0 0 0 / 0.5)', '--shadow': 'none',
    '--c-red': '#4a2522', '--c-orange': '#4a3220', '--c-yellow': '#463f1d', '--c-green': '#24402a', '--c-teal': '#1f3f3b',
    '--c-blue': '#22324a', '--c-purple': '#352a47', '--c-pink': '#462638', '--c-grey': '#353532',
    'color-scheme': 'dark',
  },
};

export interface Palette {
  id: string;
  label: string;
  kind: ThemeKind;
  bg: string;
  panel: string;
  ink: string;
  mute: string;
  acc: string;
  line: string;
  /** Anything to set by hand instead of working it out. */
  over?: Record<string, string>;
}

export function defineTheme(p: Palette): ThemeDef {
  const dark = p.kind === 'dark';
  const text = (on: string) => (contrast('#ffffff', on) >= contrast('#10151a', on) ? '#ffffff' : '#10151a');
  return {
    id: p.id,
    label: p.label,
    kind: p.kind,
    vars: {
      '--bg': p.bg,
      '--surface': p.panel,
      '--surface-2': mix(p.panel, p.ink, dark ? 0.07 : 0.05),
      '--fg': p.ink,
      '--muted': p.mute,
      '--line': p.line,
      '--accent': p.acc,
      '--accent-fg': text(p.acc),
      '--accent-soft': mix(p.panel, p.acc, dark ? 0.24 : 0.16),
      ...KIND_VARS[p.kind],
      ...p.over,
    },
  };
}
