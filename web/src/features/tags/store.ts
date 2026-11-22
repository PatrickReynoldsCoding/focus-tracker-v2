// The open profile's tags (GET /api/tags), loaded once and shared by every chip, editor and filter
// on screen; loaded again after a change lands or the profile changes. Offline: the saved copy.
import { useEffect } from 'preact/hooks';
import { get, mode, version } from '../../core/api';
import * as offline from '../../core/offline';
import { signal, useSignal } from '../../core/signal';

export const FLAG = 'tags';
/** A tag of the profile; `auto`: a project's automatic tag (D53: id project:<id>, the project's
 *  name, read only; its count is not worked out). */
export type Tag = { id: string; name: string; color: string | null; count: number; auto?: true; project_id?: string; status?: string };
export type TagOnFile = { id: string; name: string; color: string | null; auto?: true; project_id?: string };
const PATH = '/tags';

const tags = signal<{ mode: string; list: Tag[] } | null>(null);
let loaded: string | null = null;

const keep = (m: string, list: Tag[]) => {
  if (m === mode.value) tags.value = { mode: m, list };
};

function load(m: string, v: number) {
  const key = `${m}|${v}`;
  if (loaded === key) return;
  loaded = key;
  if (tags.value?.mode !== m) offline.readCopy(m, PATH).then((c) => c && tags.value?.mode !== m && keep(m, c.data as Tag[]));
  get<Tag[]>(PATH)
    .then((list) => {
      keep(m, list);
      offline.saveCopy(m, PATH, list);
    })
    .catch(() => {
      if (loaded === key) loaded = null;
    });
}

/** The profile's tags by name (undefined while loading). */
export function useTags(): Tag[] | undefined {
  const m = useSignal(mode);
  const v = useSignal(version);
  const t = useSignal(tags);
  useEffect(() => load(m, v), [m, v]);
  return t?.mode === m ? t.list : undefined;
}

/** The profile's own tags (not the projects' automatic ones). */
export function useOwnTags(): Tag[] | undefined {
  const all = useTags();
  return all?.filter((t) => !t.auto);
}

/** Show a change to the list at once (before the server's answer reloads it). */
export function patchTags(fn: (list: Tag[]) => Tag[]) {
  if (tags.value && tags.value.mode === mode.value) tags.value = { mode: tags.value.mode, list: fn(tags.value.list) };
}

export const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** A name as the server keeps it: no leading #, single spaces. */
export const cleanName = (s: string) => s.trim().replace(/^#+/, '').replace(/\s+/g, ' ');
