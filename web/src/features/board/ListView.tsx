// List view: the board as a to-do list. Each column is a group, one under the other; an item has
// a tick circle (on a board with a Done column) and a tap opens it. Ticking moves it into Done,
// which sits at the bottom, folded with Hide done. Drag an item within a group to reorder it, or to
// another group (or Done) to move it; on a phone press and hold first, or use the dialog's Status.

import { useRef } from 'preact/hooks';
import { Panels, type CardTileProps } from '../../core/registry';
import { AddInput, Linkify, plainPreview } from '../../core/ui';
import { addCard, addColumn, moveCard, tickCard, type BoardCtx } from './actions';
import { ColumnHead } from './BoardView';
import { useCardDrag } from './drag';
import { openColumns, type Card, type Column } from './model';

/** The tick circle: a tap ticks (or unticks); never starts a drag. */
export function Tick({ b, c, done }: { b: BoardCtx; c: Card; done: boolean }) {
  return (
    <button class="ub-tick" role="checkbox" aria-checked={done} aria-label={done ? `Not done: ${c.title}` : `Done: ${c.title}`} title={done ? 'Not done' : 'Done'} onClick={() => tickCard(b, c, !done)}>
      <span class="ub-circle" aria-hidden="true">
        {done ? '✓' : ''}
      </span>
    </button>
  );
}

function Row({ b, c, done, onOpen }: { b: BoardCtx; c: Card; done: boolean; onOpen: (c: Card) => void }) {
  const preview = c.note ? plainPreview(c.note, 1, 90) : '';
  return (
    <li data-id={c.id} class={`ub-item${c.color ? ` c-${c.color}` : ''}${done ? ' done' : ''}`}>
      {b.done && <Tick b={b} c={c} done={done} />}
      <span class="ub-title" role="button" tabIndex={0} onClick={() => onOpen(c)} onKeyDown={(e) => e.key === 'Enter' && onOpen(c)}>
        <span class="ub-text">
          <Linkify text={c.title} />
        </span>
        {preview && <span class="ub-note">{preview}</span>}
      </span>
      <Panels<CardTileProps> place="card-tile" props={{ card: c }} />
    </li>
  );
}

const noun = (b: BoardCtx) => (b.kind === 'project' ? 'card' : b.kind === 'todo' ? 'to-do' : 'item');

function Group({ b, cols, col, group, onOpen }: { b: BoardCtx; cols: Column[]; col: Column; group: string; onOpen: (c: Card) => void }) {
  const list = useRef<HTMLUListElement>(null);
  useCardDrag(list, group, (id, to, index) => moveCard(b, id, to, index));
  return (
    <section class="ub-group">
      <ColumnHead b={b} cols={cols} col={col} count={col.cards.length} what={`${noun(b)}s`} earlier="↑" later="↓" />
      <ul class="ub-items ub-drag" ref={list} data-col={col.id}>
        {col.cards.map((c) => (
          <Row key={c.id} b={b} c={c} done={false} onOpen={onOpen} />
        ))}
      </ul>
      <AddInput placeholder={`Add a ${noun(b)}`} onAdd={(title) => addCard(b, col.id, title)} />
    </section>
  );
}

function DoneGroup({ b, col, group, folded, onFold, onOpen }: { b: BoardCtx; col: Column; group: string; folded: boolean; onFold: (hide: boolean) => void; onOpen: (c: Card) => void }) {
  const list = useRef<HTMLUListElement>(null);
  useCardDrag(list, group, (id, to, index) => moveCard(b, id, to, index));
  return (
    <section class={`ub-group ub-done${folded ? ' folded' : ''}`}>
      <button class="ub-done-head" aria-expanded={!folded} onClick={() => onFold(!folded)} title={folded ? 'Show done' : 'Hide done'}>
        <span class="done-strip-tick" aria-hidden="true">
          ✓
        </span>
        <span class="ub-done-name">{col.name}</span>
        <span class="done-strip-count">{col.cards.length}</span>
        <span class="ub-fold" aria-hidden="true">
          {folded ? '▸' : '▾'}
        </span>
      </button>
      <ul class="ub-items ub-drag" ref={list} data-col={col.id} aria-label="Drop here to mark done">
        {!folded && col.cards.map((c) => <Row key={c.id} b={b} c={c} done onOpen={onOpen} />)}
      </ul>
    </section>
  );
}

export function ListView({ b, cols, group, onOpen, folded, onFold }: { b: BoardCtx; cols: Column[]; group: string; onOpen: (c: Card) => void; folded: boolean; onFold: (hide: boolean) => void }) {
  return (
    <div class="ub-list">
      {openColumns(cols, b.done).map((col) => (
        <Group key={col.id} b={b} cols={cols} col={col} group={group} onOpen={onOpen} />
      ))}
      <div class="ub-add-group">
        <AddInput placeholder={b.kind === 'project' ? 'Add a column' : 'Add a group'} onAdd={(name) => addColumn(b, name)} />
      </div>
      {b.done && <DoneGroup key={b.done.id} b={b} col={b.done} group={group} folded={folded} onFold={onFold} onOpen={onOpen} />}
    </div>
  );
}
