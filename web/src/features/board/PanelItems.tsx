// A to-do or a plain list inside a panel (D49, flag `panel-restyle`): one component for both, as
// the owner asked ("reuse the to-do panel but remove checkboxes"). Items sit under their group's
// name (when more than one group has items); a to-do's have a checkbox, a plain list's none. Tap
// an item's name to open it (the card dialog); drag an item to reorder it or to another group (a
// mouse at once; a finger presses and holds first, so a swipe still scrolls). The lists carry
// `.ub-drag`, so a long press on an item drags it and a long press on the panel's title or empty
// space still arranges the panels (layout/stack.tsx).

import { useRef, useState } from 'preact/hooks';
import { change, post } from '../../core/api';
import { AddInput, Linkify, todayLocal } from '../../core/ui';
import { addCard, cardChanged, deleteCard, moveCard, tickCard, type BoardCtx } from './actions';
import { CardDialog } from './CardDialog';
import { justDragged, useCardDrag } from './drag';
import { GroupBox, ListItem } from './ListItems';
import { doneColumnOf, findCard, openColumns, type Card, type Column, type SetColumns } from './model';

export type PanelProps = { kind: 'todo' | 'list'; listId: string; cols: Column[]; setCols: SetColumns };

/** What never starts a drag in a panel: the checkbox, buttons (✕), links in a title. */
const NO_DRAG = 'input, button, a, .ub-tick';

export const panelCtx = ({ kind, listId, cols, setCols }: PanelProps, get?: () => Column[]): BoardCtx => ({ get: get ?? (() => cols), set: setCols, kind, owner: { list_id: listId }, done: doneColumnOf(cols, kind, true) });

/** One item: a to-do's checkbox (none on a plain list), its name (tap to open), ✕ to delete. */
function Item({ b, c, done, onOpen, del = true }: { b: BoardCtx; c: Card; done: boolean; onOpen: (c: Card) => void; del?: boolean }) {
  const open = () => !justDragged() && onOpen(c);
  return (
    <li data-id={c.id} class={`pi-item${done ? ' done' : ''}`}>
      {b.done && <input type="checkbox" checked={done} aria-label={done ? `Not done: ${c.title}` : `Done: ${c.title}`} onChange={() => tickCard(b, c, !done)} />}
      <span
        class="pi-title"
        role="button"
        tabIndex={0}
        title="Open"
        onClick={(e) => !(e.target as Element).closest('a') && open()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(c))}
      >
        <Linkify text={c.title} />
        {!b.done && c.note && <span class="muted small tp-note-hint"> · {c.note.split('\n')[0]}</span>}
      </span>
      {del && (
        <button class="icon small" aria-label={`Delete ${c.title}`} onClick={() => deleteCard(b, c)}>
          ✕
        </button>
      )}
    </li>
  );
}

/** A group's items, draggable within the panel's group. */
function Group({ b, col, named, drag, onOpen }: { b: BoardCtx; col: Column; named: boolean; drag: string; onOpen: (c: Card) => void }) {
  const list = useRef<HTMLUListElement>(null);
  useCardDrag(list, drag, (id, to, index) => moveCard(b, id, to, index), true, NO_DRAG);
  return (
    <div class="ub-compact-group">
      {named && <h3 class="ub-compact-name">{col.name}</h3>}
      <ul class="checks pi-items ub-drag" ref={list} data-col={col.id}>
        {col.cards.map((c) => (
          <Item key={c.id} b={b} c={c} done={false} onOpen={onOpen} />
        ))}
      </ul>
    </div>
  );
}

/** A plain list's group in a panel (D58): its own box when more than one group has items, else just the rows. */
function PlainGroup({ b, col, groups, index, named, drag, onOpen }: { b: BoardCtx; col: Column; groups: Column[]; index: number; named: boolean; drag: string; onOpen: (c: Card) => void }) {
  const list = useRef<HTMLUListElement>(null);
  useCardDrag(list, drag, (id, to, i) => moveCard(b, id, to, i), true, 'a, button, .ll-more, .sub-block');
  const rows = (folded: boolean) => (
    <ul class="pi-items ll-items ub-drag" ref={list} data-col={col.id} hidden={folded}>
      {col.cards.map((c) => (
        <ListItem key={c.id} b={b} c={c} groups={groups} onOpen={onOpen} />
      ))}
    </ul>
  );
  return named ? <GroupBox col={col} index={index}>{rows}</GroupBox> : rows(false);
}

/** The card dialog for an item opened from a panel. */
function useOpenItem(b: BoardCtx, cols: Column[]) {
  const [open, setOpen] = useState<string | null>(null);
  const card = open ? findCard(cols, open) : undefined;
  const dialog = card && <CardDialog card={card} columns={cols} onClose={() => setOpen(null)} onChange={(p) => cardChanged(b, card, p)} />;
  return { onOpen: (c: Card) => setOpen(c.id), dialog };
}

export function PanelItems(p: PanelProps) {
  const colsRef = useRef(p.cols);
  colsRef.current = p.cols;
  const b = panelCtx(p, () => colsRef.current);
  const { onOpen, dialog } = useOpenItem(b, p.cols);
  const open = openColumns(p.cols, b.done);
  const first = open[0];
  const shown = open.filter((c) => c.cards.length);
  const named = shown.length > 1;
  const today = todayLocal();
  const doneToday = (b.done?.cards ?? []).filter((c) => c.done === today);
  const drag = `panel-${p.listId}`;
  return (
    <>
      {shown.map((g) =>
        p.kind === 'list' ? (
          <PlainGroup key={`${g.id}${named}`} b={b} col={g} groups={open} index={open.indexOf(g)} named={named} drag={drag} onOpen={onOpen} />
        ) : (
          <Group key={g.id} b={b} col={g} named={named} drag={drag} onOpen={onOpen} />
        ),
      )}
      {doneToday.length > 0 && (
        <ul class="checks pi-items ub-compact-done">
          {doneToday.map((c) => (
            <Item key={c.id} b={b} c={c} done onOpen={onOpen} />
          ))}
        </ul>
      )}
      <AddInput placeholder={p.kind === 'todo' ? 'Add a to-do' : 'Add an item'} onAdd={(title) => (first ? addCard(b, first.id, title) : change(() => post('/tasks', { title, list_id: p.listId })))} />
      {dialog}
    </>
  );
}

const SMALL_ITEMS = 4;

/**
 * Where a card dropped at `index` among the small version's shown cards goes on the board: before
 * the card now at that place, or after the last one shown (in that card's group).
 */
export function flatDrop(cols: Column[], shown: Card[], cardId: string, index: number): { col: string; index: number } | null {
  const others = shown.filter((c) => c.id !== cardId);
  const anchor = others[index] ?? others[others.length - 1];
  if (!anchor) return null;
  const col = cols.find((c) => c.cards.some((x) => x.id === anchor.id))!;
  const at = col.cards.filter((x) => x.id !== cardId).findIndex((x) => x.id === anchor.id);
  return { col: col.id, index: others[index] ? at : at + 1 };
}

/** The small version: the first few items (a to-do's checkbox), draggable among themselves, and how many more. */
export function SmallPanelItems(p: PanelProps) {
  const colsRef = useRef(p.cols);
  colsRef.current = p.cols;
  const b = panelCtx(p, () => colsRef.current);
  const { onOpen, dialog } = useOpenItem(b, p.cols);
  const items = openColumns(p.cols, b.done).flatMap((c) => c.cards);
  const shown = items.slice(0, SMALL_ITEMS);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const list = useRef<HTMLUListElement>(null);
  useCardDrag(
    list,
    `panel-small-${p.listId}`,
    (id, _to, index) => {
      const to = flatDrop(colsRef.current, shownRef.current, id, index);
      if (to) moveCard(b, id, to.col, to.index);
    },
    true,
    p.kind === 'list' ? 'a, button, .ll-more' : NO_DRAG,
  );
  return (
    <>
      <ul class={`${p.kind === 'list' ? 'll-items' : 'checks'} pi-items ub-drag`} ref={list} data-col="small">
        {shown.map((c) => (p.kind === 'list' ? <ListItem key={c.id} b={b} c={c} groups={[]} onOpen={onOpen} menu={false} /> : <Item key={c.id} b={b} c={c} done={false} onOpen={onOpen} del={false} />))}
      </ul>
      {items.length > SMALL_ITEMS && <p class="muted small">+{items.length - SMALL_ITEMS} more</p>}
      {dialog}
    </>
  );
}
