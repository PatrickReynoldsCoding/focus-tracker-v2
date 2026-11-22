// A colour theme (DECISIONS D61): a set of CSS variables (the tokens of styles.css) and how it
// shows in the picker. One small file per theme in this folder; index.ts picks them all up.

export type ThemeKind = 'light' | 'dark';

export interface ThemeDef {
  id: string;
  label: string;
  /** Whether it is a light or a dark look: the browser's own controls and the "follow my phone" choice use it. */
  kind: ThemeKind;
  /** Every token of styles.css, as CSS values. */
  vars: Record<string, string>;
  /** Midnight and Paper keep the open profile's colour as the accent (as before); the others use their own. */
  profileAccent?: boolean;
}
