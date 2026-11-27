// Board view: the columns side by side (a project's statuses, a to-do's groups, a plain list's
// columns), the Done column last and, with Hide done, folded into a slim strip that still takes
// a dropped card.

import { useRef } from 'preact/hooks';
import { Panels, type CardTileProps } from '../../core/registry';
import { AddInput, InlineEdit, Linkify, plainPreview } from '../../core/ui';
import { addCard, addColumn, columnPlace, deleteColumn, moveCard, moveColumn, renameColumn, type BoardCtx } from './actions';
import { DoneStripLabel } from './done';
import { useCardDrag } from './drag';
import { Tick } from './ListView';
import type { Card, Column } from './model';

/** A column's heading: its name (click to rename), count, ‹ › to reorder and ✕; the Done column has neither. */
export function ColumnHead({ b, cols, col, count, what, earlier = '‹', later = '›' }: { b: BoardCtx; cols: Column[]; col: Column; count: number; what: string; earlier?: string; later?: string }) {
  const fixedDone = col === b.done;
  const { at, count: n } = columnPlace(b, cols, col);
  return (
    <header class="column-head">
      <InlineEdit value={col.name} class="column-name" onSave={(name) => renameColumn(b, col, name)} />
      <span class="muted">{count}</span>
      {!fixedDone && at > 0 && (
        <button class="icon small column-move" aria-label={`Move ${col.name} earlier`} title="Move earlier" onClick={() => moveColumn(col, at - 1)}>
          {earlier}
        </button>
      )}
      {!fixedDone && at >= 0 && at < n - 1 && (
        <button class="icon small column-move" aria-label={`Move ${col.name} later`} title="Move later" onClick={() => moveColumn(col, at + 1)}>
          {later}
        </button>
      )}
      {!fixedDone && (
        <button class="icon small" aria-label={`Delete column ${col.name}`} onClick={() => deleteColumn(b, col, what)}>
          ✕
        </button>
      )}
    </header>
  );
}

/** The tick on an open card: one tap moves it into Done, without opening the card. */
function QuickDone({ b, c }: { b: BoardCtx; c: Card }) {
  const stop = (e: Event) => e.stopPropagation();
  return (
    <span class="kcard-done" onClick={stop} onKeyDown={stop}>
      <Tick b={b} c={c} done={false} />
    </span>
  );
}

function CardTile({ b, c, onOpen }: { b: BoardCtx; c: Card; onOpen: (c: Card) => void }) {
  const preview = c.note ? plainPreview(c.note) : '';
  return (
    <li data-id={c.id} class={`kcard c-${c.color || 'none'}`} tabIndex={0} onClick={() => onOpen(c)} onKeyDown={(e) => e.key === 'Enter' && onOpen(c)}>
      <span class="kcard-body">
        <span class="kcard-title">
          <Linkify text={c.title} />
        </span>
        {preview && <span class="kcard-note">{preview}</span>}
      </span>
      {c.note && !preview && (
        <span class="note-dot" aria-label="Has a note">
          ¶
        </span>
      )}
      <Panels<CardTileProps> place="card-tile" props={{ card: c }} />
      {b.done && c.column_id !== b.done.id && <QuickDone b={b} c={c} />}
      <Panels place="card-extra" props={{ card: c, b, view: 'board' }} />
    </li>
  );
}

const ADD = { project: 'Add a card', todo: 'Add a to-do', list: 'Add an item' };

function ColumnView({ b, cols, col, group, onOpen, folded, onUnfold }: { b: BoardCtx; cols: Column[]; col: Column; group: string; onOpen: (c: Card) => void; folded: boolean; onUnfold: () => void }) {
  const list = useRef<HTMLUListElement>(null);
  useCardDrag(list, group, (id, to, index) => moveCard(b, id, to, index));
  if (folded) {
    return (
      <section class="column done-col done-strip">
        <DoneStripLabel name={col.name} count={col.cards.length} onOpen={onUnfold} />
        <ul class="cards ub-drag" ref={list} data-col={col.id} aria-label="Drop here to mark done" />
      </section>
    );
  }
  return (
    <section class={`column${col === b.done ? ' done-col' : ''}`}>
      <ColumnHead b={b} cols={cols} col={col} count={col.cards.length} what="cards" />
      <ul class="cards ub-drag" ref={list} data-col={col.id}>
        {col.cards.map((c) => (
          <CardTile key={c.id} b={b} c={c} onOpen={onOpen} />
        ))}
      </ul>
      <AddInput placeholder={ADD[b.kind]} onAdd={(title) => addCard(b, col.id, title)} />
    </section>
  );
}

export function BoardView({ b, cols, group, onOpen, folded, onUnfold }: { b: BoardCtx; cols: Column[]; group: string; onOpen: (c: Card) => void; folded: boolean; onUnfold: () => void }) {
  const add = (
    <div class="column add-column" key="add-column">
      <AddInput placeholder="Add a column" onAdd={(name) => addColumn(b, name)} />
    </div>
  );
  return (
    <div class="board horizontal">
      {cols.map((c) => [
        // New columns go before the Done column, so the box to add one sits there.
        c === b.done ? add : null,
        <ColumnView key={`${c.id}${c === b.done && folded ? '-folded' : ''}`} b={b} cols={cols} col={c} group={group} onOpen={onOpen} folded={c === b.done && folded} onUnfold={onUnfold} />,
      ])}
      {!b.done && add}
    </div>
  );
}
