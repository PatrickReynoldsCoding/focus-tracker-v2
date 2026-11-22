// To-do items (docs/DECISIONS.md D40). A to-do (lists.kind 'todo') is a board of the board engine
// (src/modules/boards.ts): its groups are columns, it has a fixed Done column, and its items are
// cards (tasks rows with list_id). The separate todos table is gone (migration 0022).
//
// This module keeps the old to-do API answering exactly as before, over those cards: REST
// /api/todos (create, read, change, delete, move, tick), the `todos` kind of Claude's *_item tools
// and imports, add_todo and tick_todo, and the to-do shape that /api/today, /api/status, Plan my
// week, a to-do's page and the Today list read: { id, title, list_id, group_id, day, done,
// project_id, note, color, ord }. A done to-do's group_id is the group it was ticked in (the
// card's from_column_id), and project_id is the card's about_project_id.

import { z } from 'zod';
import type { Ctx } from '../core/ctx';
import type { Field, Row } from '../core/entity';
import { ApiError, bad, notFound } from '../core/errors';
import { entity, type KindAlias, type Module } from '../core/registry';
import { create, get, move, remove, update, type ListOptions } from '../core/store';
import { firstColumn, tasksEntity, tickCard, todoDoneColumn } from './boards';
import { addSubtasks, needSubtasks, subtasksArg } from './subtasks';

export const TODO_FIELDS: Record<string, Field> = {
  title: { type: 'text', required: true },
  list_id: { type: 'text', ref: 'lists', desc: 'Defaults to the first to-do list (made if there is none)' },
  group_id: { type: 'text', ref: 'columns', desc: 'A group (column) of the list; defaults to its first' },
  day: { type: 'day' },
  done: { type: 'day' },
  project_id: { type: 'text', ref: 'projects' },
  note: { type: 'markdown' },
  color: { type: 'text' },
};
const BASE = ['id', 'mode', 'created', 'updated_at', 'ord', 'base_updated_at'];

/** A to-do's group: its column, or for a done one the group it was ticked in (else the first group). */
const GROUP = `CASE WHEN c.is_done = 1 THEN COALESCE(t.from_column_id,
    (SELECT x.id FROM columns x WHERE x.list_id = t.list_id AND x.is_done = 0 ORDER BY x.ord, x.created LIMIT 1)) ELSE t.column_id END`;

/** Every to-do card of the mode (the first parameter) in the old to-do shape. */
const TODO_ROWS = `SELECT t.id, t.mode, t.title, t.list_id, ${GROUP} AS group_id, t.day, t.done, t.about_project_id AS project_id,
    t.note, t.color, t.created, t.updated_at, t.ord
  FROM tasks t JOIN lists l ON l.id = t.list_id JOIN columns c ON c.id = t.column_id
  WHERE t.mode = ? AND l.kind = 'todo'`;

/** To-dos as the old todos table gave them: exact filters on its fields, an extra SQL condition, its order. */
export async function readTodos(ctx: Ctx, opts: ListOptions = {}): Promise<Row[]> {
  const cond: string[] = [];
  const params: unknown[] = [ctx.mode];
  for (const [k, v] of Object.entries(opts.where ?? {})) {
    if (!(k in TODO_FIELDS) && k !== 'id') throw bad(`Cannot filter todos by ${k}`);
    if (v === null) cond.push(`${k} IS NULL`);
    else {
      cond.push(`${k} = ?`);
      params.push(v);
    }
  }
  if (opts.sql) {
    cond.push(`(${opts.sql})`);
    params.push(...(opts.params ?? []));
  }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const limit = Math.min(opts.limit ?? 500, 2000);
  const res = await ctx.db
    .prepare(`SELECT * FROM (${TODO_ROWS}) ${where} ORDER BY ${opts.order ?? 'ord, created'} LIMIT ${limit} OFFSET ${opts.offset ?? 0}`)
    .bind(...params)
    .all<Row>();
  return res.results;
}

export async function getTodo(ctx: Ctx, id: string): Promise<Row> {
  const [row] = await readTodos(ctx, { where: { id }, limit: 1 });
  if (!row) throw notFound('to-do', id);
  return row;
}

export async function todoCount(ctx: Ctx, mode: string): Promise<number> {
  const r = await ctx.db
    .prepare("SELECT COUNT(*) AS n FROM tasks t JOIN lists l ON l.id = t.list_id WHERE t.mode = ? AND l.kind = 'todo'")
    .bind(mode)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

/** Open to-dos due today or earlier, plus those done today (so a tick does not make them vanish at once). */
export function todosForDay(ctx: Ctx, day: string) {
  return readTodos(ctx, { sql: '(day IS NOT NULL AND day <= ? AND done IS NULL) OR done = ?', params: [day, day], order: 'done IS NOT NULL, day, ord' });
}

/** The first to-do list (made if there is none): where a to-do without a list goes. */
export async function defaultTodoList(ctx: Ctx): Promise<Row> {
  const lists = entity('lists');
  const r = await ctx.db.prepare("SELECT id FROM lists WHERE mode = ? AND kind = 'todo' ORDER BY ord, created LIMIT 1").bind(ctx.mode).first<{ id: string }>();
  return r ? get(ctx, lists, r.id) : create(ctx, lists, { name: 'To-dos', kind: 'todo', show_today: true });
}

function checkFields(input: Record<string, unknown>) {
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || k in TODO_FIELDS || BASE.includes(k)) continue;
    throw bad(`to-do has no field "${k}". Fields: ${Object.keys(TODO_FIELDS).join(', ')}`);
  }
}

async function todoList(ctx: Ctx, id: unknown): Promise<Row> {
  const l = await ctx.db.prepare('SELECT id, name, kind FROM lists WHERE id = ? AND mode = ?').bind(String(id), ctx.mode).first<Row>();
  if (!l) throw bad(`list_id: no list with id ${id}`);
  if (l.kind !== 'todo') throw bad(`${l.name} is not a to-do list`);
  return l;
}

/** A group of a to-do (an open column of its board). */
async function groupOf(ctx: Ctx, listId: string, groupId: unknown): Promise<Row> {
  const g = await ctx.db.prepare('SELECT * FROM columns WHERE id = ? AND mode = ?').bind(String(groupId), ctx.mode).first<Row>();
  if (!g) throw bad(`group_id: no column with id ${groupId}`);
  if (g.list_id !== listId) throw bad('That group is on another list');
  if (g.is_done) throw bad('Done is not a group: tick the to-do to put it there');
  return g;
}

/** The card behind a to-do (404 when the id is not a to-do). */
async function cardOf(ctx: Ctx, id: string): Promise<Row> {
  await getTodo(ctx, id);
  return get(ctx, tasksEntity, id);
}

async function inDone(ctx: Ctx, card: Row): Promise<boolean> {
  return !!(await ctx.db.prepare('SELECT is_done FROM columns WHERE id = ?').bind(card.column_id).first<{ is_done: number }>())?.is_done;
}

/** A conflict (409) answers with the to-do as it is now, in the to-do shape. */
async function asTodoConflict<T>(ctx: Ctx, id: string, p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError && err.status === 409 && err.data) err.data.current = await getTodo(ctx, id);
    throw err;
  }
}

export async function createTodo(ctx: Ctx, input: Record<string, unknown>, opts: { raw?: boolean } = {}): Promise<Row> {
  checkFields(input);
  const { group_id, list_id, project_id, base_updated_at: _b, ...rest } = input;
  const l = list_id ? await todoList(ctx, list_id) : await defaultTodoList(ctx);
  const column = group_id ? await groupOf(ctx, l.id, group_id) : await firstColumn(ctx, null, l.id);
  const card = await create(ctx, tasksEntity, { ...rest, list_id: l.id, column_id: column.id, about_project_id: project_id }, opts);
  return getTodo(ctx, card.id);
}

export async function updateTodo(ctx: Ctx, id: string, input: Record<string, unknown>): Promise<Row> {
  checkFields(input);
  const card = await cardOf(ctx, id);
  const { group_id, list_id, project_id, done, base_updated_at, ...rest } = input;
  const patch: Record<string, unknown> = { ...rest };
  if (project_id !== undefined) patch.about_project_id = project_id;
  let listId = String(card.list_id);
  if (list_id !== undefined && list_id !== card.list_id) {
    if (!list_id) throw bad('list_id cannot be empty');
    listId = (await todoList(ctx, list_id)).id;
  }
  // A new group (or list): an open to-do moves to that column; a done one stays in Done and remembers it.
  if (group_id !== undefined || listId !== card.list_id) {
    const group = group_id ? await groupOf(ctx, listId, group_id) : await firstColumn(ctx, null, listId);
    if (await inDone(ctx, card)) {
      if (listId !== card.list_id) patch.column_id = (await todoDoneColumn(ctx, listId)).id;
      patch.from_column_id = group.id;
    } else if (group.id !== card.column_id) patch.column_id = group.id;
  }
  let base = base_updated_at;
  if (Object.keys(patch).length) {
    await asTodoConflict(ctx, id, update(ctx, tasksEntity, id, { ...patch, base_updated_at: base }));
    base = undefined;
  }
  // Done last and on its own, so a day sent with it does not keep the old status (done-column.ts).
  if (done !== undefined) await asTodoConflict(ctx, id, update(ctx, tasksEntity, id, { done, base_updated_at: base }));
  return getTodo(ctx, id);
}

export async function removeTodo(ctx: Ctx, id: string): Promise<Row> {
  const row = await getTodo(ctx, id);
  await remove(ctx, tasksEntity, id);
  return row;
}

/** Reorder a to-do (before_id, after_id, index) and/or move it to another group (group_id) or list (list_id). */
export async function moveTodo(ctx: Ctx, id: string, target: Record<string, unknown>): Promise<Row> {
  const { group_id, list_id, before_id, after_id, index } = target;
  const card = await cardOf(ctx, id);
  if (!(await inDone(ctx, card)) && (group_id || list_id)) {
    const listId = list_id ? (await todoList(ctx, list_id)).id : String(card.list_id);
    const group = group_id ? await groupOf(ctx, listId, group_id) : await firstColumn(ctx, null, listId);
    await move(ctx, tasksEntity, id, { column_id: group.id, before_id: before_id as string, after_id: after_id as string, index: index as number });
    return getTodo(ctx, id);
  }
  if (group_id || list_id) await updateTodo(ctx, id, { group_id: group_id ?? undefined, list_id: list_id ?? undefined });
  await move(ctx, tasksEntity, id, { before_id: before_id as string, after_id: after_id as string, index: index as number });
  return getTodo(ctx, id);
}

/** Tick a to-do done (today) or not done: its card goes into the to-do's Done column, or back to its group. */
export async function tickTodo(ctx: Ctx, id: string, done: boolean): Promise<Row> {
  await cardOf(ctx, id);
  await tickCard(ctx, id, done);
  return getTodo(ctx, id);
}

export const todosAlias: KindAlias = {
  name: 'todos',
  singular: 'to-do',
  desc: 'Items of to-do lists, in the old to-do shape (they are cards of the to-do’s board: kind tasks with list_id). day empty = anytime; done = the day it was done.',
  of: 'tasks',
  fields: TODO_FIELDS,
  list: readTodos,
  get: getTodo,
  create: createTodo,
  update: updateTodo,
  remove: removeTodo,
  move: moveTodo,
  count: todoCount,
};

export const todosModule: Module = {
  id: 'todos',
  description: 'To-do items: the old to-do API over the cards of to-dos.',
  aliases: [todosAlias],
  routes(api) {
    api.post('/todos/:id/tick', async (c) => {
      const ctx = c.get('ctx');
      ctx.label = 'tick to-do';
      const body = await c.req.json<{ done?: boolean }>().catch(() => ({ done: true }));
      return c.json(await tickTodo(ctx, c.req.param('id'), body.done !== false));
    });
  },
  tools: [
    {
      name: 'add_todo',
      description: 'Add a to-do. Without list_id it goes on the first to-do list. day (YYYY-MM-DD) makes it due that day; empty means anytime. subtasks adds a checklist of subtasks under it (more later with add_subtask; tick them with tick_subtask).',
      input: z.object({
        title: z.string().min(1),
        list_id: z.string().optional(),
        group_id: z.string().optional(),
        day: z.string().optional(),
        project_id: z.string().optional(),
        note: z.string().optional(),
        subtasks: subtasksArg,
      }),
      run: async (ctx, { subtasks, ...a }) => {
        await needSubtasks(ctx, subtasks);
        const todo = await createTodo(ctx, a);
        return subtasks?.length ? { ...todo, subtasks: await addSubtasks(ctx, todo.id, subtasks) } : todo;
      },
    },
    {
      name: 'tick_todo',
      description: 'Mark a to-do done (today) or not done. Done moves its card into the to-do’s Done column; not done moves it back to its group. Its subtasks are left as they are.',
      input: z.object({ id: z.string(), done: z.boolean().default(true) }),
      run: (ctx, a) => tickTodo(ctx, a.id, a.done),
    },
  ],
};

