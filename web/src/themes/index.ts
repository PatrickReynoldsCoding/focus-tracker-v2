/// <reference types="vite/client" />
// The colour themes. A new theme is one small file in this folder (copy sand.ts): it is found here by itself.

import type { ThemeDef } from './types';

const found = import.meta.glob<{ default: ThemeDef }>(['./*.ts', '!./index.ts', '!./define.ts', '!./types.ts'], { eager: true });
const ORDER = ['midnight', 'paper', 'forest', 'ocean', 'sunset', 'berry', 'sand', 'slate'];

export const COLOUR_THEMES: ThemeDef[] = Object.values(found)
  .map((m) => m.default)
  .filter((t): t is ThemeDef => !!t && typeof t === 'object' && 'vars' in t)
  .sort((a, b) => (ORDER.indexOf(a.id) + 1 || 99) - (ORDER.indexOf(b.id) + 1 || 99) || a.label.localeCompare(b.label));

export const themeById = (id: string | null | undefined): ThemeDef | undefined => COLOUR_THEMES.find((t) => t.id === id);

/** The rule that puts a theme's tokens on the page. */
export const themeCss = (t: ThemeDef) =>
  `:root[data-theme="${t.id}"]{${Object.entries(t.vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(';')}}`;
