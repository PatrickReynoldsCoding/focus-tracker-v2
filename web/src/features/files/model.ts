// Shared bits of the Files tab: what GET /api/files answers, the device's view choices, dates.
import { useState } from 'preact/hooks';
import type { FileItem } from '../../core/registry';

export const FLAG = 'files-tab';

export type Folder = {
  id: string;
  name: string;
  parent_id: string | null;
  project_id: string | null;
  created: string;
  updated_at: string;
  /** The project's status, for a project's folder. */
  status?: string | null;
  /** Where it is, in a search. */
  location?: string | null;
  /** Projects and its category folders (D52): made from the categories, not stored. */
  virtual?: 'projects' | 'category';
  /** A category folder's category (null: No category) and colour (a palette name or #rrggbb). */
  category_id?: string | null;
  color?: string | null;
  /** Folders inside a virtual folder. */
  count?: number;
};
export type Crumb = { id: string; name: string; project_id: string | null; virtual?: 'projects' | 'category' };
export type Listing = { folder: Folder | null; path: Crumb[]; folders: Folder[]; files: FileItem[]; more: boolean };

/** Something in the listing: a folder or a file. */
export type Entry = { kind: 'folder'; folder: Folder } | { kind: 'file'; file: FileItem };
export const entryKey = (e: Entry) => (e.kind === 'folder' ? `folder:${e.folder.id}` : `${e.file.type}:${e.file.id}`);
export const entryName = (e: Entry) => (e.kind === 'folder' ? e.folder.name : e.file.name);
export const entryRef = (e: Entry) => (e.kind === 'folder' ? { type: 'folder', id: e.folder.id } : { type: e.file.type, id: e.file.id });

export const folderHref = (id: string | null) => (id ? `#/files/${id}` : '#/files');
export const FINISHED = ['done', 'dropped'];

/** A choice kept on this device (localStorage). */
export function usePref<T extends string>(key: string, fallback: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T | null) ?? fallback;
    } catch {
      return fallback;
    }
  });
  return [
    v,
    (next: T) => {
      setV(next);
      try {
        localStorage.setItem(key, next);
      } catch {
        /* private mode */
      }
    },
  ];
}

export const isPhone = () => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 699px)').matches;
/** A mouse or trackpad: files and folders can be dragged onto folders. */
export const canDrag = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: fine)').matches;

/** "14:05" today, "3 Nov" this year, "3 Nov 2025" before. */
export function changed(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export const DRAG_TYPE = 'application/x-ft-file';

/** What is being moved, for where it may go (D52). */
export type Moving = 'file' | 'folder' | 'project-folder';
export const movingOf = (e: Entry): Moving => (e.kind === 'file' ? 'file' : e.folder.project_id ? 'project-folder' : 'folder');
/** Whether something can be moved into a place (null: the top level). A project's folder goes only
 *  into a category's folder (its category changes); anything else never into the virtual folders. */
export function canMoveInto(moving: Moving, target: { virtual?: 'projects' | 'category' } | null): boolean {
  if (moving === 'project-folder') return target?.virtual === 'category';
  return !target?.virtual;
}
/** The plural of a count of folders inside a virtual folder. */
export const virtualSub = (f: Folder) =>
  f.virtual === 'projects' ? 'Your projects, by category' : `Category · ${f.count ?? 0} project${f.count === 1 ? '' : 's'}`;
