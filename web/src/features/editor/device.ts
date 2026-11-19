// What the editor keeps on this device (localStorage, never required): drafts, the paper
// theme and the editor heights. Every access is in try/catch (private mode, blocked storage).
import { signal } from '../../core/signal';

const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* full or blocked: the draft only lives in memory */
  }
};

// ---------- drafts ----------

export interface Draft {
  /** What was typed. */
  text: string;
  /** The text the edit started from, and its version on the server (null: unknown or new). */
  baseText: string;
  base: string | null;
  at: number;
  /** Saved offline, then refused because the note had changed elsewhere: opening it offers the choice at once. */
  clash?: boolean;
}

const DRAFT = 'ft.draft.';

export function getDraft(key: string | undefined): Draft | null {
  if (!key) return null;
  try {
    const d = JSON.parse(read(DRAFT + key) ?? 'null');
    return d && typeof d.text === 'string' ? d : null;
  } catch {
    return null;
  }
}
export function setDraft(key: string | undefined, d: Draft | null): void {
  if (key) write(DRAFT + key, d ? JSON.stringify(d) : null);
}

// ---------- paper and heights ----------

export type Paper = 'plain' | 'legal' | 'grid' | 'dot';
export const PAPERS: { id: Paper; label: string }[] = [
  { id: 'plain', label: 'Plain' },
  { id: 'legal', label: 'Legal pad' },
  { id: 'grid', label: 'Grid' },
  { id: 'dot', label: 'Dot' },
];
const isPaper = (p: string | null): p is Paper => PAPERS.some((x) => x.id === p);

export const paper = signal<Paper>(((p) => (isPaper(p) ? p : 'plain'))(read('ft.editor.paper')));
export function setPaper(p: Paper) {
  paper.value = p;
  write('ft.editor.paper', p);
}

/** The height the editor was dragged to, per place ('card', 'project', 'list', …). */
export function getHeight(place: string): number | null {
  const h = Number(read(`ft.editor.height.${place}`));
  return h >= 120 ? h : null;
}
export const setHeight = (place: string, h: number | null) => write(`ft.editor.height.${place}`, h === null ? null : String(Math.round(h)));
