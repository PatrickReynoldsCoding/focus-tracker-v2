// A to-do or a plain list inside a panel (Today, a project's linked lists, a window): the same
// board, drawn small. A to-do shows its open items under their group's name (when it has more than
// one group) with a tick, then those done today, struck through, so a tick does not make an item
// vanish at once. With the flag panel-restyle (D49) a plain list's panel is the same, without
// ticks, and items can be dragged (PanelItems.tsx); off, a plain list shows its items and nothing
// drags (a long press arranges the panel).

import { change, post } from '../../core/api';
import { useFlag } from '../../core/features';
import { AddInput, todayLocal } from '../../core/ui';
import { PanelItems, SmallPanelItems } from './PanelItems';
import { addCard, deleteCard, tickCard, type BoardCtx } from './actions';
import { allCards, doneColumnOf, openColumns, openCount, type Card, type Column, type SetColumns } from './model';

export type CompactProps = { kind: 'todo' | 'list'; listId: string; cols: Column[]; setCols: SetColumns };

const ctxOf = ({ kind, listId, cols, setCols }: CompactProps): BoardCtx => ({ get: () => cols, set: setCols, kind, owner: { list_id: listId }, done: doneColumnOf(cols, kind, true) });

/** How many items are left: a to-do's open ones, a plain list's all. */
export const leftIn = (kind: 'todo' | 'list', cols: Column[]) => openCount(cols, doneColumnOf(cols, kind, true));

/** The items a one-at-a-time panel picks from: a to-do's open ones, a plain list's all. */
export const pickable = (kind: 'todo' | 'list', cols: Column[]): Card[] => openColumns(cols, doneColumnOf(cols, kind, true)).flatMap((c) => c.cards);

function CheckRow({ b, c, done }: { b: BoardCtx; c: Card; done: boolean }) {
  return (
    <li class={done ? 'done' : ''}>
      <label>
        <input type="checkbox" checked={done} onChange={() => tickCard(b, c, !done)} />
        <span>{c.title}</span>
      </label>
      <button class="icon small" aria-label={`Delete ${c.title}`} onClick={() => deleteCard(b, c)}>
        ✕
      </button>
    </li>
  );
}

export function CompactItems(p: CompactProps) {
  const restyle = useFlag('panel-restyle');
  return restyle ? <PanelItems {...p} /> : <OldCompactItems {...p} />;
}

function OldCompactItems(p: CompactProps) {
  const b = ctxOf(p);
  const open = openColumns(p.cols, b.done);
  const first = open[0];
  const add = (
    <AddInput placeholder={p.kind === 'todo' ? 'Add a to-do' : 'Add an item'} onAdd={(title) => (first ? addCard(b, first.id, title) : change(() => post('/tasks', { title, list_id: p.listId })))} />
  );
  if (p.kind === 'list') {
    const cards = allCards(p.cols);
    return (
      <>
        {cards.length > 0 && (
          <ul class="plain tp-items">
            {cards.map((c) => (
              <li key={c.id}>
                <span>{c.title}</span>
                {c.note && <span class="muted small tp-note-hint"> · {c.note.split('\n')[0]}</span>}
              </li>
            ))}
          </ul>
        )}
        {add}
      </>
    );
  }
  const today = todayLocal();
  const named = open.filter((c) => c.cards.length).length > 1;
  const doneToday = (b.done?.cards ?? []).filter((c) => c.done === today);
  return (
    <>
      {open.map((g) =>
        g.cards.length ? (
          <div key={g.id} class="ub-compact-group">
            {named && <h3 class="ub-compact-name">{g.name}</h3>}
            <ul class="checks">
              {g.cards.map((c) => (
                <CheckRow key={c.id} b={b} c={c} done={false} />
              ))}
            </ul>
          </div>
        ) : null,
      )}
      {doneToday.length > 0 && (
        <ul class="checks ub-compact-done">
          {doneToday.map((c) => (
            <CheckRow key={c.id} b={b} c={c} done />
          ))}
        </ul>
      )}
      {add}
    </>
  );
}

const SMALL_ITEMS = 4;

/** The small version: the first few items (a to-do's tick), and how many more. */
export function SmallItems(p: CompactProps) {
  const restyle = useFlag('panel-restyle');
  return restyle ? <SmallPanelItems {...p} /> : <OldSmallItems {...p} />;
}

function OldSmallItems(p: CompactProps) {
  const b = ctxOf(p);
  const items = pickable(p.kind, p.cols);
  return (
    <>
      <ul class="plain tp-items">
        {items.slice(0, SMALL_ITEMS).map((c) =>
          p.kind === 'todo' ? (
            <li key={c.id}>
              <label>
                <input type="checkbox" checked={false} onChange={() => tickCard(b, c, true)} /> <span>{c.title}</span>
              </label>
            </li>
          ) : (
            <li key={c.id}>{c.title}</li>
          ),
        )}
      </ul>
      {items.length > SMALL_ITEMS && <p class="muted small">+{items.length - SMALL_ITEMS} more</p>}
    </>
  );
}
