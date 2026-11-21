// The projects of the open profile, loaded once and shared by every project label on screen, so a
// label never costs a request of its own. Loaded again (once) after a change lands or the profile
// changes; the last list stays on screen meanwhile. Offline: the saved copy of the same address.
import { get, mode, version } from '../../core/api';
import * as offline from '../../core/offline';
import { useEffect } from 'preact/hooks';
import { signal, useSignal } from '../../core/signal';

export type ProjectName = { id: string; name: string; status: string };
const PATH = '/projects?limit=2000';

const names = signal<{ mode: string; byId: Map<string, ProjectName> } | null>(null);
let loaded: string | null = null;

const keep = (m: string, list: ProjectName[]) => {
  if (m === mode.value) names.value = { mode: m, byId: new Map(list.map((p) => [p.id, p])) };
};

function load(m: string, v: number) {
  const key = `${m}|${v}`;
  if (loaded === key) return;
  loaded = key;
  if (names.value?.mode !== m) offline.readCopy(m, PATH).then((c) => c && names.value?.mode !== m && keep(m, c.data as ProjectName[]));
  get<ProjectName[]>(PATH)
    .then((list) => {
      keep(m, list);
      offline.saveCopy(m, PATH, list);
    })
    .catch(() => {
      // Try again with the next change; the saved copy (if any) is already showing.
      if (loaded === key) loaded = null;
    });
}

/** A project of the open profile by id (undefined while loading or when it is not there). */
export function useProjectName(id: string): ProjectName | undefined {
  const m = useSignal(mode);
  const v = useSignal(version);
  const n = useSignal(names);
  useEffect(() => load(m, v), [m, v]);
  return n?.mode === m ? n.byId.get(id) : undefined;
}
