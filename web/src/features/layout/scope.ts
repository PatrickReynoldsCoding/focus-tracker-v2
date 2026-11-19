// Where the desktop grid keeps its layout. By default a page's own (`layout.<page>`, with its
// removed panels); Today's pills (pills.tsx) give each pill its own: the grid inside a pill reads
// and saves that pill's layout, and Remove, Add and Reset act on the pill.

import { createContext } from 'preact';
import type { PanelDef } from '../../core/registry';
import type { Grid } from './store';

export interface GridStore {
  /** Changes when the store does, so the grid is drawn afresh (a pill's id). */
  key: string;
  /** What Edit layout says it is changing ('the pill “Home”'). */
  label: string;
  saved: Grid | null;
  /** The saved layout now (read by event handlers). */
  read: () => Grid | null;
  save: (g: Grid) => Promise<boolean>;
  /** Edit layout's Remove (take the panel out of the pill); `base` is the grid with the places on screen. */
  remove: (p: PanelDef<any>, base?: Grid) => void;
  /** Edit layout's add button and its text. */
  add: () => void;
  addLabel: string;
  /** Edit layout's reset and its text. */
  reset: () => void;
  resetLabel: string;
}

export const GridScope = createContext<GridStore | null>(null);
