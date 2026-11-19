// Where the desktop grid keeps its layout. By default a page's own (`layout.<page>`, with its
// removed panels); Today's pills (pills.tsx) give each pill its own: the grid (or the phone's stack)
// inside a pill reads and saves that pill's layout, and Remove, Add and Reset act on the pill.

import { createContext } from 'preact';
import type { PanelDef } from '../../core/registry';
import type { Grid } from './store';

export interface GridStore {
  /** Changes when the store does, so the grid is drawn afresh (a pill's id). */
  key: string;
  /** What is being arranged, for people ('the pill “Home”'). */
  label: string;
  saved: Grid | null;
  /** The saved layout now (read by event handlers). */
  read: () => Grid | null;
  save: (g: Grid) => Promise<boolean>;
  /** A panel's Remove (take the panel out of the pill); `base` is the grid with the places on screen. */
  remove: (p: PanelDef<any>, base?: Grid) => void;
  removeLabel: string;
  /** Put panels on (for a pill: its sheet). The page's own grid opens Add panels instead. */
  add: () => void;
  addLabel: string;
  /** Back to the usual layout, and its text. */
  reset: () => void;
  resetLabel: string;
}

export const GridScope = createContext<GridStore | null>(null);
