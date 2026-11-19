// "+ Add feature" in Edit layout: what can be put on this page (panels removed from it, then the
// notes, lists and whiteboards its sources offer), and below them what is on it already, greyed.

import { useEffect, useState } from 'preact/hooks';
import { useSources, type Addable, type PanelDef } from '../../core/registry';
import { Dialog, Loading } from '../../core/ui';
import { layoutNow, saveGrid, titleOf } from './store';

export const KIND_GROUP: Record<string, string> = { list: 'Lists', todo: 'To-do lists', note: 'Notes', whiteboard: 'Whiteboards' };
const GROUP_ORDER = ['Lists', 'To-do lists', 'Notes', 'Whiteboards'];

/** Everything the sources of a place could add, grouped by kind (loaded when asked). */
export function useAddable(place: string): Addable[] | null {
  const sources = useSources(place);
  const [list, setList] = useState<Addable[] | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all(sources.map((s) => (s.addable ? s.addable().catch(() => [] as Addable[]) : Promise.resolve([] as Addable[])))).then((all) => live && setList(all.flat()));
    return () => {
      live = false;
    };
  }, [place, sources.length]);
  return list;
}

export function groupByKind<T extends { kind?: string }>(list: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const x of list) {
    const g = KIND_GROUP[x.kind ?? ''] ?? 'Panels';
    groups.set(g, [...(groups.get(g) ?? []), x]);
  }
  return [...groups.entries()].sort((a, b) => GROUP_ORDER.indexOf(a[0]) - GROUP_ORDER.indexOf(b[0]));
}

export function AddFeature({ place, all, onClose }: { place: string; all: PanelDef<any>[]; onClose: () => void }) {
  const removed = new Set(layoutNow(place).grid?.removed ?? []);
  const movable = all.filter((p) => !p.fixed);
  const back = movable.filter((p) => removed.has(p.id) && !p.alwaysShown);
  const on = movable.filter((p) => !removed.has(p.id) || p.alwaysShown);
  const offered = useAddable(place);
  const [added, setAdded] = useState<string[]>([]);

  const putBack = (p: PanelDef<any>) => {
    const g = layoutNow(place).grid;
    if (g) saveGrid(place, { ...g, removed: g.removed.filter((x) => x !== p.id) });
    setAdded((a) => [...a, p.id]);
  };
  const add = async (a: Addable) => {
    setAdded((x) => [...x, a.id]);
    await a.add();
  };
  const row = (id: string, title: string, description: string | undefined, onAdd: (() => void) | null) => (
    <li key={id} class={onAdd ? '' : 'lg-on'}>
      <div>
        <strong>{title}</strong>
        {description && <span class="muted small"> {description}</span>}
      </div>
      {onAdd ? (
        <button class="small primary" onClick={onAdd} aria-label={`Add ${title}`}>
          Add
        </button>
      ) : (
        <span class="muted small lg-tick">✓ On page</span>
      )}
    </li>
  );
  return (
    <Dialog title="Add feature" onClose={onClose} wide>
      <div class="lg-add">
        {back.length > 0 && (
          <>
            <h3>Removed from this page</h3>
            <ul class="lg-add-list">{back.map((p) => row(p.id, titleOf(p), p.description, added.includes(p.id) ? null : () => putBack(p)))}</ul>
          </>
        )}
        {offered === null ? (
          <Loading />
        ) : (
          groupByKind(offered).map(([group, list]) => (
            <div key={group}>
              <h3>{group}</h3>
              <ul class="lg-add-list">{list.map((a) => row(a.id, a.title, a.description, added.includes(a.id) ? null : () => add(a)))}</ul>
            </div>
          ))
        )}
        {offered && !back.length && !offered.length && <p class="muted">Everything this page can show is on it already.</p>}
        <h3>On this page</h3>
        <ul class="lg-add-list">{on.map((p) => row(p.id, titleOf(p), p.description, null))}</ul>
      </div>
    </Dialog>
  );
}
