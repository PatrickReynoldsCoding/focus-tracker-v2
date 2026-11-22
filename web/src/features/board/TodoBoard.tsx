// The to-do screen (D41): one component for a to-do, a plain list and a project's board. Each
// switches between Board view (columns side by side) and List view (groups one under the other;
// a to-do's and a project's items have tick circles, Done folded at the bottom); the view is
// remembered on this device for each board. A plain list is list-only (D58: no switch, groups as
// boxes, ListItems.tsx), has no Done column, ticks or days, and can be made a to-do (one way).
// Flag `unified-board` off: no switch; a project shows as a board, a to-do and a plain list as a list.

import { useEffect, useRef, useState } from 'preact/hooks';
import { useFlag } from '../../core/features';
import { cardChanged, type BoardCtx } from './actions';
import { BoardView } from './BoardView';
import { CardDialog } from './CardDialog';
import { DONE_FLAG, HideDoneButton, setHideDone } from './done';
import { ListView } from './ListView';
import { useLocalHideDone, useView } from './memory';
import { doneColumnOf, findCard, UNIFIED_FLAG, type BoardKind, type Card, type Column, type Owner, type View } from './model';
import './board.css';

function ViewSwitch({ view, onView }: { view: View; onView: (v: View) => void }) {
  return (
    <div class="ub-seg" role="group" aria-label="View">
      {(['board', 'list'] as const).map((v) => (
        <button key={v} class={view === v ? 'on' : ''} aria-pressed={view === v} onClick={() => onView(v)}>
          {v === 'board' ? '▥ Board' : '☰ List'}
        </button>
      ))}
    </div>
  );
}

/**
 * `onColumns` hears every change made on the board, so the page's data (and its saved copy for
 * offline use) keeps it. A project also gets `hideDone` and `onHideDone` (saved on the project);
 * a plain list's page gives `onConvert` (make it a to-do).
 */
export function TodoBoard({
  kind,
  owner,
  columns,
  onColumns,
  hideDone,
  onHideDone,
  name,
  onConvert,
}: {
  kind: BoardKind;
  owner: Owner;
  columns: Column[];
  onColumns?: (cols: Column[]) => void;
  hideDone?: boolean;
  onHideDone?: (hide: boolean) => void;
  name?: string;
  onConvert?: () => void;
}) {
  const doneFlag = useFlag(DONE_FLAG);
  const unified = useFlag(UNIFIED_FLAG);
  const [cols, setColsState] = useState(columns);
  const colsRef = useRef(cols);
  colsRef.current = cols;
  const [open, setOpen] = useState<string | null>(null);
  const boardId = owner.project_id ? `p:${owner.project_id}` : `l:${owner.list_id}`;
  const [saved, setView] = useView(boardId, kind === 'project' ? 'board' : 'list');
  const [localHide, setLocalHide] = useLocalHideDone(owner.list_id ?? '');
  useEffect(() => setColsState(columns), [columns]);
  useEffect(() => {
    if (cols !== columns) onColumns?.(cols);
  }, [cols]);

  const done = doneColumnOf(cols, kind, doneFlag);
  const b: BoardCtx = { get: () => colsRef.current, set: (fn) => setColsState(fn), kind, owner, done };
  // A plain list is list-only (D58); a to-do and a project switch between Board and List.
  const view: View = kind === 'list' ? 'list' : unified ? saved : kind === 'todo' ? 'list' : 'board';
  const folded = !!done && (kind === 'project' ? !!hideDone : localHide);
  const fold = (hide: boolean) => {
    if (kind !== 'project') return setLocalHide(hide);
    if (owner.project_id && onHideDone) setHideDone(owner.project_id, hide, onHideDone);
  };
  const canFold = !!done && (kind !== 'project' || !!onHideDone);
  const convert = () => {
    if (confirm(`Make ${name ? `“${name}”` : 'this list'} a to-do? It gets tick circles, a Done column and due dates. A to-do cannot go back to a plain list.`)) onConvert?.();
  };
  const card = open ? findCard(cols, open) : undefined;
  const group = `board-${boardId}`;
  // A plain list is `ub-plain`: `ub-list` is List view's own box.
  return (
    <div class={`board-wrap ub ub-${kind === 'list' ? 'plain' : kind} ub-view-${view}`}>
      <div class="board-tools ub-tools">
        {unified && kind !== 'list' && <ViewSwitch view={view} onView={setView} />}
        {canFold && <HideDoneButton hidden={folded} count={done!.cards.length} onToggle={() => fold(!folded)} />}
        {unified && kind === 'list' && onConvert && (
          <button class="ghost small" onClick={convert}>
            ☐ Convert to to-do
          </button>
        )}
      </div>
      {view === 'board' ? (
        <BoardView b={b} cols={cols} group={group} onOpen={(c) => setOpen(c.id)} folded={folded} onUnfold={() => fold(false)} />
      ) : (
        <ListView b={b} cols={cols} group={group} onOpen={(c) => setOpen(c.id)} folded={folded} onFold={fold} />
      )}
      {card && <CardDialog card={card} columns={cols} onClose={() => setOpen(null)} onChange={(p: Partial<Card> | null) => cardChanged(b, card, p)} />}
    </div>
  );
}
