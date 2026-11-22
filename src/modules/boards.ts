// The board engine (docs/DECISIONS.md D40): one piece of logic for every board of columns and
// cards, whoever owns it. A board belongs to a project (columns.project_id, tasks.project_id) or
// to a list (columns.list_id, tasks.list_id), and is one of three kinds:
//   project  a project's board: To do, Doing and a fixed Done column (D34, flag `done-column`)
//   todo     a to-do (lists.kind 'todo'): its columns are groups, plus a fixed Done column
//   list     a plain list (lists.kind 'list'): columns only, no Done column
// Columns, cards, moves, ticks and days all go through here; src/modules/done-column.ts keeps a
// card's done day in step with the Done column, for every way a card is written.

import { z } from 'zod';
import type { Ctx } from '../core/ctx';
import type { Entity, Row } from '../core/entity';
import { bad } from '../core/errors';
import type { Module } from '../core/registry';
import { create, get, list, move, update } from '../core/store';

/** A new project's columns; the last is its fixed Done column (D34). */
export const DEFAULT_COLUMNS = ['To do', 'Doing', 'Done'];
/** A new to-do's first group, and a new plain list's first column. */
export const TODO_FIRST_COLUMN = 'General';
export const LIST_FIRST_COLUMN = 'Items';
export const DONE_NAME = 'Done';
/** Flag: every project has one fixed Done column, always last; a card is done exactly when it is in it (src/modules/done-column.ts). */
export const DONE_FLAG = 'done-column';

export type BoardKind = 'project' | 'todo' | 'list';
export type Owner = { project_id: string; list_id?: undefined } | { list_id: string; project_id?: undefined };

export const columnsEntity: Entity = {
  name: 'columns',
  table: 'columns',
  singular: 'column',
  desc: 'Columns of a board: a project’s statuses, a to-do’s groups (each to-do and project has one fixed Done column, is_done) or a plain list’s columns.',
  modeScoped: true,
  orderGroup: ['project_id', 'list_id'],
  filters: ['project_id', 'list_id'],
  fields: {
    name: { type: 'text', required: true },
    project_id: { type: 'text', ref: 'projects', cascade: true },
    list_id: { type: 'text', ref: 'lists', cascade: true },
    is_done: { type: 'bool', default: false, desc: 'The board’s fixed Done column (projects and to-dos): one per board, always last, cannot be deleted; a card is done exactly while it is in it' },
  },
  beforeCreate(_ctx, row) {
    if (!row.project_id === !row.list_id) throw bad('A column belongs to exactly one of project_id or list_id');
  },
  beforeUpdate(_ctx, _before, patch) {
    if ('project_id' in patch || 'list_id' in patch) throw bad('A column cannot move to another board');
  },
};

async function ownerOfColumn(ctx: Ctx, columnId: string) {
  const col = await get(ctx, columnsEntity, columnId);
  return { project_id: col.project_id ?? null, list_id: col.list_id ?? null };
}

export const tasksEntity: Entity = {
  name: 'tasks',
  table: 'tasks',
  singular: 'card',
  desc: 'Cards: on a project board, on a to-do (its items) and on a plain list (its items). The note is Markdown.',
  modeScoped: true,
  orderGroup: ['column_id'],
  filters: ['project_id', 'list_id', 'column_id', 'color'],
  fields: {
    title: { type: 'text', required: true },
    column_id: { type: 'text', ref: 'columns', cascade: true, desc: 'Defaults to the board’s first column' },
    project_id: { type: 'text', ref: 'projects', cascade: true },
    list_id: { type: 'text', ref: 'lists', cascade: true },
    note: { type: 'markdown' },
    color: { type: 'text' },
    day: { type: 'day', desc: 'The day it is for: it shows in the Today list from that day until done (empty: no day)' },
    done: {
      type: 'day',
      desc: 'The day it was done. On a project or a to-do a card is done exactly while it is in the Done column: setting done moves it there, clearing it moves it out',
    },
    from_column_id: { type: 'text', ref: 'columns', desc: 'Set by the app: the column a card was in before it went into Done (a to-do card goes back there when unticked)' },
    about_project_id: { type: 'text', ref: 'projects', desc: 'A to-do card’s project, when it is about one (not on that project’s board)' },
  },
  async beforeCreate(ctx, row) {
    if (!row.column_id) {
      if (!row.project_id && !row.list_id) throw bad('A card needs column_id, project_id or list_id');
      row.column_id = (await firstColumn(ctx, row.project_id as string | null, row.list_id as string | null)).id;
    }
    Object.assign(row, await ownerOfColumn(ctx, String(row.column_id)));
  },
  async beforeUpdate(ctx, before, patch) {
    if ('project_id' in patch || 'list_id' in patch) throw bad('Move a card by changing its column_id');
    if (patch.column_id) Object.assign(patch, await ownerOfColumn(ctx, String(patch.column_id)));
    // Flag done-column off: a project card with a day is done while it is in its board's last column (D30).
    // Otherwise src/modules/done-column.ts keeps done in step with the Done column for every card.
    if (patch.column_id && !(await ctx.feature(DONE_FLAG)) && patch.column_id !== before.column_id && before.project_id && (patch.day ?? before.day) && !('done' in patch)) {
      const last = await doneColumn(ctx, String(before.project_id));
      if (last) patch.done = patch.column_id === last.id ? (before.done ?? (await ctx.today())) : null;
    }
  },
};

// ---------- what kind of board ----------

const whereOf = (o: Owner): Record<string, string> => (o.project_id ? { project_id: o.project_id } : { list_id: o.list_id! });

export function ownerOf(row: Record<string, unknown>): Owner | null {
  if (row.project_id) return { project_id: String(row.project_id) };
  if (row.list_id) return { list_id: String(row.list_id) };
  return null;
}

export async function boardKind(ctx: Ctx, owner: Owner): Promise<BoardKind> {
  if (owner.project_id) return 'project';
  const r = await ctx.db.prepare('SELECT kind FROM lists WHERE id = ? AND mode = ?').bind(owner.list_id, ctx.mode).first<{ kind: string }>();
  return r?.kind === 'todo' ? 'todo' : 'list';
}

/** Whether the board has a fixed Done column whose cards are done: a to-do always, a project while the flag done-column is on. */
export async function hasDoneColumn(ctx: Ctx, owner: Owner): Promise<boolean> {
  const kind = await boardKind(ctx, owner);
  return kind === 'todo' || (kind === 'project' && (await ctx.feature(DONE_FLAG)));
}

/** A board's Done column, without making one. */
export async function doneOf(ctx: Ctx, owner: Owner): Promise<{ id: string } | null> {
  const col = owner.project_id ? 'project_id' : 'list_id';
  return ctx.db
    .prepare(`SELECT id FROM columns WHERE mode = ? AND ${col} = ? AND is_done = 1 LIMIT 1`)
    .bind(ctx.mode, owner.project_id ?? owner.list_id)
    .first<{ id: string }>();
}

/** A to-do's Done column (made if it has none). */
export async function todoDoneColumn(ctx: Ctx, listId: string): Promise<Row> {
  const cols = await list(ctx, columnsEntity, { where: { list_id: listId } });
  return cols.find((c) => c.is_done) ?? create(ctx, columnsEntity, { list_id: listId, name: DONE_NAME, is_done: true });
}

/**
 * The column that means done on a project's board: its Done column (made if it has none), or,
 * with the flag done-column off, its last column when it has two or more.
 */
export async function doneColumn(ctx: Ctx, projectId: string): Promise<Row | null> {
  const cols = await list(ctx, columnsEntity, { where: { project_id: projectId } });
  if (await ctx.feature(DONE_FLAG)) return cols.find((c) => c.is_done) ?? (await create(ctx, columnsEntity, { project_id: projectId, name: DONE_NAME, is_done: true }));
  return cols.length > 1 ? cols[cols.length - 1] : null;
}

/** The column that means done on any board (null for a plain list). */
export async function doneColumnOf(ctx: Ctx, owner: Owner): Promise<Row | null> {
  if (owner.project_id) return doneColumn(ctx, owner.project_id);
  return (await boardKind(ctx, owner)) === 'todo' ? todoDoneColumn(ctx, owner.list_id!) : null;
}

/**
 * The first column of a board that is not its Done column. A project with none gets To do /
 * Doing / Done (or To do, if it has only a Done column); a list gets its first column.
 */
export async function firstColumn(ctx: Ctx, projectId: string | null, listId: string | null): Promise<Row> {
  if (listId) {
    const cols = await list(ctx, columnsEntity, { where: { list_id: listId } });
    const open = cols.filter((c) => !c.is_done);
    if (open.length) return open[0];
    const kind = await boardKind(ctx, { list_id: listId });
    return create(ctx, columnsEntity, { list_id: listId, name: kind === 'todo' ? TODO_FIRST_COLUMN : LIST_FIRST_COLUMN });
  }
  const cols = await list(ctx, columnsEntity, { where: { project_id: projectId } });
  const open = (await ctx.feature(DONE_FLAG)) ? cols.filter((c) => !c.is_done) : cols;
  if (open.length) return open[0];
  if (cols.length) return create(ctx, columnsEntity, { project_id: projectId, name: DEFAULT_COLUMNS[0] });
  let first: Row | null = null;
  for (const [i, name] of DEFAULT_COLUMNS.entries()) {
    const c = await create(ctx, columnsEntity, { project_id: projectId, name, is_done: i === DEFAULT_COLUMNS.length - 1 });
    first ??= c;
  }
  return first!;
}

/** The columns a new board starts with. */
export async function makeColumns(ctx: Ctx, owner: Owner, kind: BoardKind): Promise<void> {
  if (kind === 'project') {
    for (const [i, name] of DEFAULT_COLUMNS.entries()) await create(ctx, columnsEntity, { ...owner, name, is_done: i === DEFAULT_COLUMNS.length - 1 });
    return;
  }
  await create(ctx, columnsEntity, { ...owner, name: kind === 'todo' ? TODO_FIRST_COLUMN : LIST_FIRST_COLUMN });
  if (kind === 'todo') await create(ctx, columnsEntity, { ...owner, name: DONE_NAME, is_done: true });
}

/** Find a column of a board by name (case-insensitive). */
export async function columnByName(ctx: Ctx, owner: Owner, name: string): Promise<Row> {
  const cols = await list(ctx, columnsEntity, { where: whereOf(owner) });
  const c = cols.find((x) => String(x.name).toLowerCase() === name.trim().toLowerCase());
  if (!c) throw bad(`No column "${name}". Columns: ${cols.map((x) => x.name).join(', ')}`);
  return c;
}

/** A board's columns (statuses or groups) with their cards; each card says its status (its column's name). The Done column is last. */
export async function board(ctx: Ctx, where: { project_id?: string; list_id?: string }) {
  const owner = ownerOf(where);
  const [cols, cards, sortDone] = await Promise.all([
    list(ctx, columnsEntity, { where }),
    list(ctx, tasksEntity, { where, limit: 2000 }),
    owner ? hasDoneColumn(ctx, owner) : false,
  ]);
  if (sortDone) cols.sort((a, b) => Number(!!a.is_done) - Number(!!b.is_done));
  return cols.map((c) => ({ ...c, cards: cards.filter((t) => t.column_id === c.id).map((t) => ({ ...t, status: c.name })) }));
}

// ---------- changing cards ----------

/**
 * Tick a card off (or back on). On a project or a to-do it moves into the Done column, or out
 * of it (a project card to the first column, a to-do card back to the group it came from; with
 * the flag done-column off, a project's last of two or more columns); a plain list's item only
 * records the day.
 */
export async function tickCard(ctx: Ctx, id: string, done: boolean) {
  const card = await get(ctx, tasksEntity, id);
  const today = await ctx.today();
  if (card.project_id) {
    const last = await doneColumn(ctx, String(card.project_id));
    if (last) {
      const to = done ? last : await firstColumn(ctx, String(card.project_id), null);
      if (card.column_id !== to.id) await move(ctx, tasksEntity, id, { column_id: to.id });
    }
  }
  return update(ctx, tasksEntity, id, { done: done ? today : null });
}

/** Put a card in the Today list from a day (null takes it out). Clears an earlier tick of a plain list's item; a project's or to-do's card keeps its status (D34). */
export function setCardDay(ctx: Ctx, id: string, day: string | null) {
  return update(ctx, tasksEntity, id, { day, done: null });
}

/** Add a card: to a column (by id or name) or to the board's first column. */
export async function addCard(ctx: Ctx, input: Record<string, unknown> & { column?: string }) {
  const { column, ...a } = input;
  if (column && !a.column_id) {
    const owner = ownerOf(a);
    if (!owner) throw bad('Give project_id or list_id with a column name');
    a.column_id = (await columnByName(ctx, owner, column)).id;
  }
  return create(ctx, tasksEntity, a);
}

/** Move a card to another column (by id or name) and/or position. */
export async function moveCard(ctx: Ctx, id: string, target: { column_id?: string; column?: string; before_id?: string; after_id?: string; index?: number }) {
  const { column, ...t } = target;
  if (column && !t.column_id) {
    const card = await get(ctx, tasksEntity, id);
    t.column_id = (await columnByName(ctx, ownerOf(card)!, column)).id;
  }
  return move(ctx, tasksEntity, id, t);
}

/** Edit a card; status (a column name) moves it, done true/false ticks it (into or out of Done). */
export async function updateCard(ctx: Ctx, id: string, a: { status?: string; done?: boolean } & Record<string, unknown>) {
  const { status, done, ...fields } = a;
  const card = await get(ctx, tasksEntity, id);
  const patch: Record<string, unknown> = { ...fields };
  if (status) {
    const col = await columnByName(ctx, ownerOf(card)!, status);
    if (col.id !== card.column_id) await move(ctx, tasksEntity, id, { column_id: col.id });
  } else if (done !== undefined) {
    // A project card moves into or out of its Done column (that sets done); so does a to-do's
    // card (through done-column.ts); a plain list's item only records the day.
    if (card.project_id && (await doneColumn(ctx, String(card.project_id)))) {
      const col = done ? await doneColumn(ctx, String(card.project_id)) : await firstColumn(ctx, String(card.project_id), null);
      if (col && col.id !== card.column_id) await move(ctx, tasksEntity, id, { column_id: col.id });
    }
    patch.done = done ? (card.done ?? (await ctx.today())) : null;
  }
  return update(ctx, tasksEntity, id, patch);
}

const cardInput = {
  title: z.string().min(1),
  note: z.string().optional().describe('Markdown'),
  color: z.string().optional(),
};

export const boardsModule: Module = {
  id: 'boards',
  description: 'Boards of columns and cards: project boards, to-dos and plain lists.',
  entities: [columnsEntity, tasksEntity],
  routes(api) {
    api.get('/boards/:kind/:id', async (c) => {
      const kind = c.req.param('kind');
      if (kind !== 'project' && kind !== 'list') throw bad('Board kind is project or list');
      return c.json(await board(c.get('ctx'), kind === 'project' ? { project_id: c.req.param('id') } : { list_id: c.req.param('id') }));
    });
    api.post('/tasks/:id/tick', async (c) => {
      const ctx = c.get('ctx');
      const b = await c.req.json<{ done?: unknown }>().catch(() => ({}) as { done?: unknown });
      ctx.label = b.done === false ? 'untick card' : 'tick card';
      return c.json(await tickCard(ctx, c.req.param('id'), b.done !== false));
    });
  },
  tools: [
    {
      name: 'add_card',
      description:
        'Add a card to a project board, a to-do (list_id) or a plain list (list_id). Give column_id, or a column (status or group) name, or neither for the first column. A card added to Done is done.',
      input: z.object({
        project_id: z.string().optional(),
        list_id: z.string().optional(),
        column_id: z.string().optional(),
        column: z.string().optional().describe('Column (status) name, instead of column_id'),
        ...cardInput,
      }),
      run: (ctx, a) => addCard(ctx, a),
    },
    {
      name: 'update_card',
      description:
        'Edit a card’s title, Markdown note or colour, or its status: a column name of its board (it moves to the end of that column), or done true (into the Done column) / false (back out of it).',
      input: z.object({
        id: z.string(),
        title: z.string().optional(),
        note: z.string().nullable().optional(),
        color: z.string().nullable().optional(),
        status: z.string().optional().describe('Column name on the same board'),
        done: z.boolean().optional(),
      }),
      run: (ctx, { id, ...a }) => updateCard(ctx, id, a),
    },
    {
      name: 'move_card',
      description: 'Move a card to another column (status, by id or name) and/or position. Without a position it goes to the end. Into the Done column marks it done; out of it, not done.',
      input: z.object({
        id: z.string(),
        column_id: z.string().optional(),
        column: z.string().optional().describe('Column name on the same board'),
        before_id: z.string().optional(),
        after_id: z.string().optional(),
        index: z.number().int().optional(),
      }),
      run: (ctx, { id, ...t }) => moveCard(ctx, id, t),
    },
    {
      name: 'get_board',
      description: 'The columns (statuses or groups) and cards of a project board, a to-do or a plain list. is_done marks the fixed Done column of a project or to-do, always last.',
      readOnly: true,
      input: z.object({ project_id: z.string().optional(), list_id: z.string().optional() }),
      run: (ctx, a) => board(ctx, a.project_id ? { project_id: a.project_id } : { list_id: a.list_id }),
    },
    {
      name: 'set_card_day',
      description: 'Put a card (a project board card, a to-do’s card or a plain list item) in the Today list from a day (YYYY-MM-DD), or take it out (day null). It stays until ticked. Clears an earlier tick of a plain list’s item.',
      input: z.object({ id: z.string(), day: z.string().nullable() }),
      run: (ctx, a) => setCardDay(ctx, a.id, a.day),
    },
  ],
};
