// The inside of a list panel (on Today, a project's page, a window): a to-do's or a plain list's
// board drawn small (features/board/Compact.tsx, the same board as the list's page). Works on GET
// /api/lists/:id/full.

import { Adaptive } from '../../core/adaptive';
import { useFlag } from '../../core/features';
import { ProjectLabel } from '../../core/registry';
import { columnsOfList, CompactItems, leftIn, pickable, SmallItems, type Column } from '../board';
import { ListTitle } from './ListDialog';
import { OneAtATime, type QuoteItem } from './OneAtATime';

export type FullList = {
  id: string;
  name: string;
  kind: 'list' | 'todo';
  color: string | null;
  display: 'full' | 'one';
  seconds: number;
  project_id: string | null;
  columns?: Column[];
  groups?: { id: string; name: string; todos: { id: string; title: string; day: string | null; done: string | null; note?: string | null }[] }[];
};
export type SetList = (fn: (l: FullList) => FullList) => void;

/** How many items are left: a to-do's open ones, a plain list's all. */
export const countOf = (l: FullList) => leftIn(l.kind, columnsOfList(l));

/** The board's columns, and how to change them, for the small views. */
const boardProps = (l: FullList, setList: SetList) => ({
  kind: l.kind,
  listId: l.id,
  cols: columnsOfList(l),
  setCols: (fn: (c: Column[]) => Column[]) => setList((d) => ({ ...d, columns: fn(columnsOfList(d)) })),
});

/** A list as a panel: head with the name (a link to its page), then the items. */
export function ListPanel({ l, setList, onRemove }: { l: FullList; setList: SetList; onRemove?: () => void }) {
  const oneFlag = useFlag('list-one-at-a-time');
  if (oneFlag && l.display === 'one') {
    const items: QuoteItem[] = pickable(l.kind, columnsOfList(l)).map((c) => ({ id: c.id, title: c.title, note: c.note }));
    return <OneAtATime list={l} setList={setList} items={items} onRemove={onRemove} />;
  }
  const count = countOf(l);
  return (
    <Adaptive small={() => <ListSmall l={l} setList={setList} />}>
      <FullListPanel l={l} setList={setList} onRemove={onRemove} count={count} />
    </Adaptive>
  );
}

/** The small list: its title, how many items, and the first few (a to-do ticks). */
function ListSmall({ l, setList }: { l: FullList; setList: SetList }) {
  return (
    <section class="card tp-list panel-small" style={l.color ? { borderTop: `4px solid var(--c-${l.color})` } : undefined}>
      <div class="card-head">
        <h2>
          <ListTitle list={l} setList={setList as (fn: (l: any) => any) => void} prefix={l.kind === 'todo' ? '☐ ' : '≡ '} />
          <ProjectLabel projectId={l.project_id} />
        </h2>
        <span class="muted">{countOf(l)}</span>
      </div>
      <SmallItems {...boardProps(l, setList)} />
    </section>
  );
}

function FullListPanel({ l, setList, onRemove, count }: { l: FullList; setList: SetList; onRemove?: () => void; count: number }) {
  return (
    <section class="card tp-list" data-pat-top={l.color || undefined} style={l.color ? { borderTop: `4px solid var(--c-${l.color})` } : undefined}>
      <div class="card-head">
        <h2>
          <ListTitle list={l} setList={setList as (fn: (l: any) => any) => void} prefix={l.kind === 'todo' ? '☐ ' : '≡ '} />
          <ProjectLabel projectId={l.project_id} />
        </h2>
        <span class="row tight">
          <span class="muted">{count}</span>
          {onRemove && (
            <button class="icon small" aria-label={`Remove ${l.name} from Today`} title="Remove from Today" onClick={onRemove}>
              ✕
            </button>
          )}
        </span>
      </div>
      <CompactItems {...boardProps(l, setList)} />
    </section>
  );
}
