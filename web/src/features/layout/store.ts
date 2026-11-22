// The saved layout of a page (GET /api/layout/<place>): the desktop grid, Today's pills, each
// pill's own grid and the switches. One copy per mode and place, shared by every component that
// needs it (the grid, the phone's stack, the pills, Today settings). A change shows at once and is saved behind;
// a refused save puts the old one back with a message.

import { useEffect, useReducer } from 'preact/hooks';
import { del, get, HttpError, mode, newId, put, say, undo, version } from '../../core/api';
import * as offline from '../../core/offline';
import { signal, useSignal } from '../../core/signal';

/** A panel's place: column, width, order, a fixed height on a computer (h) and on a phone (ph). */
export type Pos = { x: number; y: number; w: number; h?: number | null; ph?: number | null };
export type Grid = { items: Record<string, Pos>; removed: string[] };
export type Pill = { id: string; name: string; icon: string | null; panels: string[] };
export type View = { focusCard?: 'compact' | 'full' | 'hidden'; pillCounts?: boolean; pillSwipe?: boolean; pillLast?: boolean; pillAll?: boolean };
/** grid: the page's grid (on Today, the All pill's); grids: each pill's own grid, by pill id. */
export type LayoutData = { grid: Grid | null; pills: Pill[] | null; grids: Record<string, Grid>; view: View };
const EMPTY: LayoutData = { grid: null, pills: null, grids: {}, view: {} };

export const COLS = 12;
export const MAX_PILLS = 12;
export const PILL_NAME_MAX = 24;
/** A new, empty pill (its id is made on this device). */
export const newPill = (): Pill => ({ id: `p${newId()}`, name: '', icon: null, panels: [] });
/** The icons a pill may have (the server checks the same list). */
export const PILL_ICONS = ['🏠', '💼', '🛒', '🧠', '💪', '📚', '🎯', '📅', '✨', '🌙'];

const cache = signal<Record<string, LayoutData>>({});
const loadedAt = new Map<string, number>();
/** Bumped by every change made here, so an answer that left before it does not undo it on screen. */
let localRev = 0;
let inFlight = 0;

const path = (place: string) => `/layout/${place}`;
const keyOf = (m: string, place: string) => `${m}|${place}`;

function set(m: string, place: string, d: LayoutData) {
  cache.value = { ...cache.value, [keyOf(m, place)]: d };
}

async function load(m: string, place: string, v: number) {
  const k = keyOf(m, place);
  if (loadedAt.get(k) === v) return;
  loadedAt.set(k, v);
  if (!cache.value[k] && offline.enabled()) {
    // The saved copy first, so the page opens in its own layout, not the default one.
    const c = await offline.readCopy(m, path(place));
    if (c && !cache.value[k]) set(m, place, { ...EMPTY, ...(c.data as LayoutData) });
  }
  const rev = localRev;
  try {
    const d = await get<LayoutData>(path(place));
    if (rev === localRev && inFlight === 0 && mode.value === m) set(m, place, { grid: d.grid, pills: d.pills, grids: d.grids ?? {}, view: d.view ?? {} });
  } catch {
    // Offline with no saved copy, or the server is unhappy: draw the default layout.
    if (!cache.value[k]) set(m, place, EMPTY);
  }
}

/** The layout of a place in the current mode (undefined while the first copy loads). */
export function useLayout(place: string): LayoutData | undefined {
  const m = useSignal(mode);
  const v = useSignal(version);
  const c = useSignal(cache);
  useEffect(() => {
    load(m, place, v);
  }, [m, place, v]);
  return c[keyOf(m, place)];
}

export const layoutNow = (place: string): LayoutData => cache.value[keyOf(mode.value, place)] ?? EMPTY;

/** Change part of a place's layout on screen, then send it. A refusal puts the old one back. */
export async function saveLayout(place: string, patchData: Partial<LayoutData>, send: () => Promise<unknown>): Promise<boolean> {
  const m = mode.value;
  const before = layoutNow(place);
  const next = { ...before, ...patchData };
  localRev++;
  set(m, place, next);
  if (offline.enabled()) offline.saveCopy(m, path(place), next);
  inFlight++;
  try {
    await send();
    return true;
  } catch (err) {
    if (mode.value === m) set(m, place, before);
    if (offline.enabled()) offline.saveCopy(m, path(place), before);
    if (!(err instanceof HttpError && err.status === 401)) say(`Not saved: ${(err as Error).message}`, 'error');
    return false;
  } finally {
    inFlight--;
  }
}

export const saveGrid = (place: string, grid: Grid) => saveLayout(place, { grid }, () => put(`${path(place)}/grid`, grid));
export const savePills = (place: string, pills: Pill[]) => saveLayout(place, { pills }, () => put(`${path(place)}/pills`, { pills }));
/** One pill's own grid (the desktop's layout inside that pill). */
export const savePillGrid = (place: string, pill: string, grid: Grid) =>
  saveLayout(place, { grids: { ...layoutNow(place).grids, [pill]: { ...grid, removed: [] } } }, () => put(`${path(place)}/grids/${pill}`, grid));
/** "Reset this pill": back to its usual layout, undoable from the message. */
export async function resetPillGrid(place: string, pill: string) {
  const grids = { ...layoutNow(place).grids };
  delete grids[pill];
  const ok = await saveLayout(place, { grids }, () => del(`${path(place)}/grids/${pill}`));
  if (ok) say('This pill is back to its usual layout.', 'info', { label: 'Undo', run: undo });
}
/** The whole view is sent each time, so two changes waiting offline (merged into one) lose nothing.
 *  For every profile (scope 'all', D46) only the switches changed are sent. */
export function saveView(place: string, change: View, scope: 'profile' | 'all' = 'profile') {
  const view = { ...layoutNow(place).view, ...change };
  return saveLayout(place, { view }, () => put(`${path(place)}/view`, scope === 'all' ? { ...change, scope } : view));
}

/** True while the media query matches (re-renders when it changes). */
export function useMedia(query: string): boolean {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const mq = mediaQuery(query);
  useEffect(() => {
    const on = () => force(undefined as never);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [mq]);
  return mq.matches;
}
const queries = new Map<string, MediaQueryList>();
const mediaQuery = (q: string) => queries.get(q) ?? (queries.set(q, matchMedia(q)), queries.get(q)!);


/** The Today panel pinned above the pills (not in any pill). */
export const PINNED = 'focus';

/** Desktop: the movable grid and pop-out windows. Phone: panels one under the other, swipe between pills. */
export const DESKTOP = '(min-width: 900px)';
export const WINDOWS = '(min-width: 760px)';
export const PHONE = '(max-width: 759px)';

/** A panel's name for people: its title, else its id made readable. */
export const titleOf = (p: { id: string; title?: string }) => p.title ?? p.id.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase());
