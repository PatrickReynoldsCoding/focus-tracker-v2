// Shared bits of the whiteboards feature: the board type, the device's favourite tool, opening a board.
import { localStorageSet } from '../../core/api';
import { signal } from '../../core/signal';
import { go, route } from '../../core/ui';

export type Board = {
  id: string;
  name: string;
  project_id: string | null;
  show_today: boolean;
  thumbnail: string | null;
  updated_at: string;
  created: string;
};

/** Same limit as the server (src/modules/whiteboards.ts), checked here first so the message is instant. */
export const MAX_SCENE_BYTES = 1_500_000;

/** Excalidraw tool names, and what Settings calls them. */
export const TOOLS: [string, string][] = [
  ['', 'None (Excalidraw’s default)'],
  ['selection', 'Selection'],
  ['rectangle', 'Rectangle'],
  ['diamond', 'Diamond'],
  ['ellipse', 'Ellipse'],
  ['arrow', 'Arrow'],
  ['line', 'Line'],
  ['freedraw', 'Draw'],
  ['text', 'Text'],
  ['eraser', 'Eraser'],
  ['hand', 'Hand (move around)'],
];

const TOOL_KEY = 'ft.whiteboard.tool';
const readTool = () => {
  try {
    return localStorage.getItem(TOOL_KEY) ?? '';
  } catch {
    return '';
  }
};
/** The tool picked when a board opens, on this device only. */
export const favouriteTool = signal(readTool());
export function setFavouriteTool(t: string) {
  favouriteTool.value = t;
  localStorageSet(TOOL_KEY, t);
}

const FROM_KEY = 'ft.wb.from';
/** Open a board full screen; closing it comes back here. */
export function openBoard(id: string) {
  try {
    sessionStorage.setItem(FROM_KEY, route.value);
  } catch {
    /* private mode */
  }
  go(`/w/${id}`);
}
/** Leave the open board: back to the page it was opened from, or the Whiteboards tab. */
export function leaveBoard() {
  let from: string | null = null;
  try {
    from = sessionStorage.getItem(FROM_KEY);
    sessionStorage.removeItem(FROM_KEY);
  } catch {
    /* private mode */
  }
  if (from && history.length > 1) history.back();
  else go('/whiteboards');
}

export function savedAgo(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 1 && d.toDateString() === new Date().toDateString()) return `today ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: days > 300 ? 'numeric' : undefined });
}
