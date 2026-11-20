// A Kanban board (a project's) or a plain list's columns. Drag cards between
// columns (press and hold on a phone), add cards in each column, open a card to edit.

import Sortable from 'sortablejs';
import { useEffect, useRef, useState } from 'preact/hooks';
import { change, del, localStorageSet, newId, optimistic, patch, post } from '../../core/api';
import { Panels, registerPanel, type CardSectionProps, type CardTileProps } from '../../core/registry';
import { useFlag } from '../../core/features';
import { AddInput, ColorPicker, Dialog, InlineEdit, Linkify, MarkdownEditor, plainPreview } from '../../core/ui';
import { DONE_FLAG, DoneStripLabel, HideDoneButton, setHideDone } from './done-column';

export type Card = { id: string; title: string; note: string | null; color: string | null; column_id: string; ord: number };
/** A column is a status; `is_done` marks a project's fixed Done column (D34). */
export type Column = { id: string; name: string; cards: Card[]; is_done?: boolean };

/** The card dialog; other features open it too (a linked card). */
export function CardDialog({ card, columns, onClose, onChange }: { card: Card; columns: Column[]; onClose: () => void; onChange: (c: Partial<Card> | null) => void }) {
  const save = (p: Record<string, unknown>) => {
    onChange(p as Partial<Card>);
    change(() => patch(`/tasks/${card.id}`, p));
  };
  return (
    <Dialog title={<InlineEdit value={card.title} onSave={(title) => title && save({ title })} />} onClose={onClose} wide>
      <div class="stack">
        <Panels<CardSectionProps> place="card" props={{ card, columns, save, update: (f) => onChange(f as Partial<Card> | null), close: onClose }} />
      </div>
    </Dialog>
  );
}

// The card dialog's sections. Other features add theirs with registerPanel('card', ...).
registerPanel('card', {
  id: 'note',
  order: 10,
  render: ({ card, save }) => <MarkdownEditor value={card.note ?? ''} placeholder="Add a note (Markdown)…" onSave={(note) => save({ note })} />,
});
registerPanel('card', { id: 'color', order: 20, render: ({ card, save }) => <ColorPicker value={card.color} onPick={(color) => save({ color })} /> });
registerPanel('card', {
  id: 'column',
  order: 30,
  render: ({ card, columns, update }) => (
    <label class="inline">
      {columns.some((c) => (c as Column).is_done) ? 'Status' : 'Column'}
      <select
        value={card.column_id}
        onChange={(e) => {
          const column_id = (e.target as HTMLSelectElement).value;
          update({ column_id });
          change(() => post(`/tasks/${card.id}/move`, { column_id }));
        }}
      >
        {columns.map((c) => (
          <option key={c.id} value={c.id}>
            {(c as Column).is_done ? `✓ ${c.name}` : c.name}
          </option>
        ))}
      </select>
    </label>
  ),
});
registerPanel('card', {
  id: 'delete',
  order: 1000,
  render: ({ card, update, close }) => (
    <div class="row">
      <button
        class="danger ghost"
        onClick={() => {
          close();
          update(null);
          change(() => del(`/tasks/${card.id}`), 'Card deleted');
        }}
      >
        Delete card
      </button>
    </div>
  ),
});

function ColumnView({
  col,
  owner,
  onOpen,
  setCols,
  cols,
  doneOn,
  folded,
  onUnfold,
}: {
  col: Column;
  owner: { project_id?: string; list_id?: string };
  onOpen: (c: Card) => void;
  setCols: (fn: (c: Column[]) => Column[]) => void;
  cols: Column[];
  /** The board has a fixed Done column (flag done-column): it cannot be moved or deleted. */
  doneOn?: boolean;
  /** Hide done is on: draw the column as a slim strip. */
  folded?: boolean;
  onUnfold?: () => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const colsRef = useRef(cols);
  colsRef.current = cols;
  useEffect(() => {
    const s = Sortable.create(listRef.current!, {
      group: `board-${owner.project_id ?? owner.list_id}`,
      animation: 150,
      delay: 220,
      delayOnTouchOnly: true,
      ghostClass: 'drag-ghost',
      dataIdAttr: 'data-id',
      onEnd: (evt) => {
        const cardId = evt.item.dataset.id!;
        const toCol = (evt.to as HTMLElement).dataset.col!;
        const index = evt.newIndex ?? 0;
        // Put the DOM back; Preact draws the new order from state.
        evt.from.insertBefore(evt.item, evt.from.children[evt.oldIndex ?? 0] ?? null);
        if (evt.from === evt.to && evt.oldIndex === evt.newIndex) return;
        const before = colsRef.current;
        optimistic(
          () => {
            setCols((cs) => {
              const card = cs.flatMap((c) => c.cards).find((c) => c.id === cardId)!;
              const without = cs.map((c) => ({ ...c, cards: c.cards.filter((x) => x.id !== cardId) }));
              return without.map((c) => (c.id === toCol ? { ...c, cards: [...c.cards.slice(0, index), { ...card, column_id: toCol }, ...c.cards.slice(index)] } : c));
            });
            return () => setCols(() => before);
          },
          () => post(`/tasks/${cardId}/move`, { column_id: toCol, index }),
        );
      },
    });
    return () => s.destroy();
  }, []);

  const addCard = (title: string) => {
    const id = newId();
    optimistic(
      () => {
        setCols((cs) => cs.map((c) => (c.id === col.id ? { ...c, cards: [...c.cards, { id, title, note: null, color: null, column_id: col.id, ord: 1e9 }] } : c)));
        return () => setCols((cs) => cs.map((c) => ({ ...c, cards: c.cards.filter((x) => x.id !== id) })));
      },
      () => post('/tasks', { id, title, column_id: col.id }),
    );
  };

  // Reorder: other columns move among themselves; the Done column stays last.
  const fixedDone = !!doneOn && !!col.is_done;
  const movable = doneOn ? cols.filter((c) => !c.is_done) : cols;
  const at = movable.findIndex((c) => c.id === col.id);
  const moveTo = (index: number) => change(() => post(`/columns/${col.id}/move`, { index }));

  if (folded) {
    return (
      <section class="column done-col done-strip">
        <DoneStripLabel name={col.name} count={col.cards.length} onOpen={() => onUnfold?.()} />
        <ul class="cards" ref={listRef} data-col={col.id} aria-label={`Drop here to mark done`} />
      </section>
    );
  }

  return (
    <section class={`column${fixedDone ? ' done-col' : ''}`}>
      <header class="column-head">
        <InlineEdit
          value={col.name}
          class="column-name"
          onSave={(name) => {
            if (!name) return;
            setCols((cs) => cs.map((c) => (c.id === col.id ? { ...c, name } : c)));
            change(() => patch(`/columns/${col.id}`, { name }));
          }}
        />
        <span class="muted">{col.cards.length}</span>
        {!fixedDone && at > 0 && (
          <button class="icon small column-move" aria-label={`Move ${col.name} earlier`} title="Move earlier" onClick={() => moveTo(at - 1)}>
            ‹
          </button>
        )}
        {!fixedDone && at >= 0 && at < movable.length - 1 && (
          <button class="icon small column-move" aria-label={`Move ${col.name} later`} title="Move later" onClick={() => moveTo(at + 1)}>
            ›
          </button>
        )}
        {!fixedDone && <button
          class="icon small"
          aria-label={`Delete column ${col.name}`}
          onClick={() => {
            if (col.cards.length && !confirm(`Delete "${col.name}" and its ${col.cards.length} cards? (Undo brings them back.)`)) return;
            change(() => del(`/columns/${col.id}`), 'Column deleted');
          }}
        >
          ✕
        </button>}
      </header>
      <ul class="cards" ref={listRef} data-col={col.id}>
        {col.cards.map((c) => (
          <li key={c.id} data-id={c.id} class={`kcard c-${c.color || 'none'}`} tabIndex={0} onClick={() => onOpen(c)} onKeyDown={(e) => e.key === 'Enter' && onOpen(c)}>
            <span class="kcard-body">
              <span class="kcard-title"><Linkify text={c.title} /></span>
              {c.note && plainPreview(c.note) && <span class="kcard-note">{plainPreview(c.note)}</span>}
            </span>
            {c.note && !plainPreview(c.note) && (
              <span class="note-dot" aria-label="Has a note">
                ¶
              </span>
            )}
            <Panels<CardTileProps> place="card-tile" props={{ card: c }} />
          </li>
        ))}
      </ul>
      <AddInput placeholder="Add a card" onAdd={addCard} />
    </section>
  );
}

/**
 * `onColumns` hears every change made on the board, so the page's data (and its saved copy for offline use) keeps it.
 * A project's board also gets `hideDone` and `onHideDone` (its Done column folded or not, saved on the project).
 */
export function Board({
  columns,
  owner,
  onColumns,
  hideDone,
  onHideDone,
}: {
  columns: Column[];
  owner: { project_id?: string; list_id?: string };
  onColumns?: (cols: Column[]) => void;
  hideDone?: boolean;
  onHideDone?: (hide: boolean) => void;
}) {
  const doneFlag = useFlag(DONE_FLAG);
  const [cols, setColsState] = useState(columns);
  const [open, setOpen] = useState<Card | null>(null);
  const isPhone = typeof matchMedia !== 'undefined' && matchMedia('(max-width: 700px)').matches;
  const [layout, setLayout] = useState<'h' | 'v'>(() => {
    try {
      return (localStorage.getItem('ft.board') as 'h' | 'v') ?? (isPhone ? 'v' : 'h');
    } catch {
      return isPhone ? 'v' : 'h';
    }
  });
  useEffect(() => setColsState(columns), [columns]);
  useEffect(() => {
    if (cols !== columns) onColumns?.(cols);
  }, [cols]);
  const setCols = (fn: (c: Column[]) => Column[]) => setColsState(fn);
  const done = doneFlag && owner.project_id ? cols.find((c) => c.is_done) : undefined;
  const folded = !!done && !!hideDone;
  const toggleDone = (hide: boolean) => owner.project_id && onHideDone && setHideDone(owner.project_id, hide, onHideDone);
  const addColumn = (
    <div class="column add-column" key="add-column">
      <AddInput placeholder="Add a column" onAdd={(name) => change(() => post('/columns', { ...owner, name }))} />
    </div>
  );
  return (
    <div class="board-wrap">
      <div class="board-tools">
        {done && onHideDone && <HideDoneButton hidden={folded} count={done.cards.length} onToggle={() => toggleDone(!folded)} />}
        <button
          class="ghost small"
          onClick={() => {
            const next = layout === 'h' ? 'v' : 'h';
            setLayout(next);
            localStorageSet('ft.board', next);
          }}
        >
          {layout === 'h' ? '⇅ Stack columns' : '⇆ Side by side'}
        </button>
      </div>
      <div class={`board ${layout === 'h' ? 'horizontal' : 'vertical'}`}>
        {cols.map((c) => [
          // New columns go before the Done column, so the box to add one sits there.
          c === done ? addColumn : null,
          <ColumnView
            key={`${c.id}${c === done && folded ? '-folded' : ''}`}
            col={c}
            owner={owner}
            cols={cols}
            setCols={setCols}
            onOpen={setOpen}
            doneOn={!!done}
            folded={c === done && folded}
            onUnfold={() => toggleDone(false)}
          />,
        ])}
        {!done && addColumn}
      </div>
      {open && (
        <CardDialog
          card={open}
          columns={cols}
          onClose={() => setOpen(null)}
          onChange={(p) => {
            if (p === null) setCols((cs) => cs.map((c) => ({ ...c, cards: c.cards.filter((x) => x.id !== open.id) })));
            else {
              const updated = { ...open, ...p };
              setOpen(updated);
              setCols((cs) => {
                const without = cs.map((c) => ({ ...c, cards: c.cards.filter((x) => x.id !== open.id) }));
                return without.map((c) => (c.id === updated.column_id ? { ...c, cards: p.column_id && p.column_id !== open.column_id ? [...c.cards, updated] : cs.find((x) => x.id === c.id)!.cards.map((x) => (x.id === open.id ? updated : x)) } : c));
              });
            }
          }}
        />
      )}
    </div>
  );
}
