// The shapes the to-do screen works on (D40, D41): a board of columns holding cards, whoever owns
// it. A project's board, a to-do (its columns are groups, plus the fixed Done column) and a plain
// list (columns only) are drawn by the same code. These helpers change a board on screen; the
// server is told separately (features/board/actions.ts).

export type Card = {
  id: string;
  title: string;
  note: string | null;
  color: string | null;
  column_id: string;
  ord: number;
  /** The day it is for (a to-do's due date); never on a plain list's item. */
  day?: string | null;
  /** The day it was done: a card in a Done column is done. */
  done?: string | null;
  /** The column it was in before it went into Done (a to-do card goes back there when unticked). */
  from_column_id?: string | null;
  project_id?: string | null;
  list_id?: string | null;
};
/** A column is a status (project), a group (to-do) or a column (plain list); `is_done` marks the fixed Done column. */
export type Column = { id: string; name: string; cards: Card[]; is_done?: boolean };
export type BoardKind = 'project' | 'todo' | 'list';
export type Owner = { project_id?: string; list_id?: string };
export type View = 'board' | 'list';
export type SetColumns = (fn: (cols: Column[]) => Column[]) => void;

/** The flag for the one to-do screen (Board and List views, Convert to to-do). */
export const UNIFIED_FLAG = 'unified-board';

export const allCards = (cols: Column[]) => cols.flatMap((c) => c.cards);

/** The board's Done column, if it has one that counts: a to-do always, a project while the flag done-column is on, a plain list never. */
export function doneColumnOf(cols: Column[], kind: BoardKind, doneFlag: boolean): Column | undefined {
  if (kind === 'list' || (kind === 'project' && !doneFlag)) return undefined;
  return cols.find((c) => c.is_done);
}

/** The columns that are not Done, in order. */
export const openColumns = (cols: Column[], done: Column | undefined) => cols.filter((c) => c !== done);

/** How many cards are not done (a plain list: all of them). */
export const openCount = (cols: Column[], done: Column | undefined) => openColumns(cols, done).reduce((n, c) => n + c.cards.length, 0);

/** Take a card off the board, wherever it is. */
export const dropCard = (cols: Column[], id: string): Column[] => cols.map((c) => (c.cards.some((x) => x.id === id) ? { ...c, cards: c.cards.filter((x) => x.id !== id) } : c));

/** Put a card into a column at an index (the end when none), taking it from wherever it was. */
export function placeCard(cols: Column[], card: Card, toCol: string, index?: number): Column[] {
  return dropCard(cols, card.id).map((c) => {
    if (c.id !== toCol) return c;
    const at = index === undefined ? c.cards.length : Math.max(0, Math.min(index, c.cards.length));
    return { ...c, cards: [...c.cards.slice(0, at), { ...card, column_id: toCol }, ...c.cards.slice(at)] };
  });
}

/** Change a card's fields where it is. */
export const patchCard = (cols: Column[], id: string, p: Partial<Card>): Column[] => cols.map((c) => (c.cards.some((x) => x.id === id) ? { ...c, cards: c.cards.map((x) => (x.id === id ? { ...x, ...p } : x)) } : c));

export const findCard = (cols: Column[], id: string) => allCards(cols).find((c) => c.id === id);

/** Where an unticked card goes: a to-do's card back to the group it came from (or the first group), a project's card to its first column (D34). */
export function untickTarget(cols: Column[], done: Column, card: Card, kind: BoardKind): Column | undefined {
  const open = openColumns(cols, done);
  if (kind === 'todo' && card.from_column_id) return open.find((c) => c.id === card.from_column_id) ?? open[0];
  return open[0];
}

/**
 * A list's board from GET /lists/:id/full: its `columns`. A copy saved on this device before
 * v0.35.0 has only a to-do's `groups`: drawn from those (done to-dos stay in their group).
 */
export function columnsOfList(l: { columns?: Column[]; groups?: { id: string; name: string; todos: { id: string; title: string; note?: string | null; color?: string | null; day?: string | null; done?: string | null; ord?: number }[] }[] }): Column[] {
  if (l.columns) return l.columns;
  return (l.groups ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    cards: g.todos.map((t, i) => ({ id: t.id, title: t.title, note: t.note ?? null, color: t.color ?? null, day: t.day ?? null, done: t.done ?? null, column_id: g.id, ord: t.ord ?? i })),
  }));
}
