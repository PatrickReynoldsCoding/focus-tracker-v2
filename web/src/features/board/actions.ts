// Changes to a board: shown on screen at once, then sent (rolled back with a message if refused).
// The same for every view (Board, List, the small panels on Today).

import { change, del, newId, optimistic, patch, post } from '../../core/api';
import { todayLocal } from '../../core/ui';
import { dropCard, findCard, openColumns, patchCard, placeCard, untickTarget, type BoardKind, type Card, type Column, type Owner, type SetColumns } from './model';

/** What the actions need: the board as it is now (a getter, for drag callbacks), how to change it, its kind, owner and Done column. */
export type BoardCtx = { get: () => Column[]; set: SetColumns; kind: BoardKind; owner: Owner; done: Column | undefined };

function withRollback(b: BoardCtx, apply: (cs: Column[]) => Column[]) {
  return () => {
    const before = b.get();
    b.set(apply);
    return () => b.set(() => before);
  };
}

/** Where a card ticked into Done sits: a to-do's by its place number (D40: it keeps it), a project's at the end. */
function doneIndex(b: BoardCtx, done: Column, card: Card) {
  return b.kind === 'todo' ? done.cards.filter((c) => c.ord < card.ord).length : undefined;
}

export function addCard(b: BoardCtx, columnId: string, title: string) {
  const id = newId();
  const card: Card = { id, title, note: null, color: null, column_id: columnId, ord: 1e9, list_id: b.owner.list_id ?? null, project_id: b.owner.project_id ?? null, day: null, done: null };
  return optimistic(
    () => {
      b.set((cs) => placeCard(cs, card, columnId));
      return () => b.set((cs) => dropCard(cs, id));
    },
    () => post('/tasks', { id, title, column_id: columnId }),
  );
}

/** Tick a card into the Done column, or back out of it. */
export function tickCard(b: BoardCtx, card: Card, done: boolean) {
  const doneCol = b.done;
  if (!doneCol) return;
  const today = todayLocal();
  return optimistic(
    withRollback(b, (cs) => {
      const now = findCard(cs, card.id) ?? card;
      const d = cs.find((c) => c.id === doneCol.id) ?? doneCol;
      if (done) return placeCard(cs, { ...now, done: today, from_column_id: now.column_id }, d.id, doneIndex(b, d, now));
      const to = untickTarget(cs, d, now, b.kind);
      return to ? placeCard(cs, { ...now, done: null }, to.id) : cs;
    }),
    () => post(`/tasks/${card.id}/tick`, { done }),
  );
}

/** Move a card to a column and place (a drag). Into the Done column marks it done; out of it, not done. */
export function moveCard(b: BoardCtx, cardId: string, toCol: string, index: number) {
  const doneId = b.done?.id;
  return optimistic(
    withRollback(b, (cs) => {
      const card = findCard(cs, cardId);
      if (!card) return cs;
      const into = !!doneId && toCol === doneId && card.column_id !== doneId;
      const out = !!doneId && card.column_id === doneId && toCol !== doneId;
      const p: Partial<Card> = into ? { done: card.done ?? todayLocal(), from_column_id: card.column_id } : out ? { done: null } : {};
      return placeCard(cs, { ...card, ...p }, toCol, index);
    }),
    () => post(`/tasks/${cardId}/move`, { column_id: toCol, index }),
  );
}

export function deleteCard(b: BoardCtx, card: Card) {
  return optimistic(
    withRollback(b, (cs) => dropCard(cs, card.id)),
    () => del(`/tasks/${card.id}`),
    `Deleted ${card.title}`,
  );
}

/** The card dialog changed a card (null: deleted). A new column goes to its end, Done marking it done. */
export function cardChanged(b: BoardCtx, card: Card, p: Partial<Card> | null) {
  b.set((cs) => {
    if (p === null) return dropCard(cs, card.id);
    const now = findCard(cs, card.id) ?? card;
    if (p.column_id && p.column_id !== now.column_id) {
      const into = b.done && p.column_id === b.done.id;
      const out = b.done && now.column_id === b.done.id;
      return placeCard(cs, { ...now, ...p, ...(into ? { done: now.done ?? todayLocal(), from_column_id: now.column_id } : out ? { done: null } : {}) }, p.column_id);
    }
    return patchCard(cs, card.id, p);
  });
}

// ---------- columns (statuses, groups) ----------

export function renameColumn(b: BoardCtx, col: Column, name: string) {
  if (!name || name === col.name) return;
  b.set((cs) => cs.map((c) => (c.id === col.id ? { ...c, name } : c)));
  change(() => patch(`/columns/${col.id}`, { name }));
}

export const addColumn = (b: BoardCtx, name: string) => change(() => post('/columns', { ...b.owner, name }));

/** Move a column among the others (the Done column stays last). */
export const moveColumn = (col: Column, index: number) => change(() => post(`/columns/${col.id}/move`, { index }));

export function deleteColumn(b: BoardCtx, col: Column, what: string) {
  if (col.cards.length && !confirm(`Delete "${col.name}" and its ${col.cards.length} ${what}? (Undo brings them back.)`)) return;
  change(() => del(`/columns/${col.id}`), `${col.name} deleted`);
}

/** The columns that can be moved, and where this one is among them. */
export function columnPlace(b: BoardCtx, cols: Column[], col: Column) {
  const movable = openColumns(cols, b.done);
  return { at: movable.findIndex((c) => c.id === col.id), count: movable.length };
}
