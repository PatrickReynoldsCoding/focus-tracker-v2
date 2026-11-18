// Lists (plain lists, to-do lists, notes) and to-dos.

import { z } from 'zod';
import type { Ctx } from '../core/ctx';
import type { Entity, Row } from '../core/entity';
import { bad } from '../core/errors';
import type { Module } from '../core/registry';
import { create, get, list, update } from '../core/store';
import { board, columnsEntity, firstColumn, tasksEntity } from './projects';
import { getNote, setNote } from './notes';

export const LIST_KINDS = ['list', 'todo', 'note'] as const;

export const listsEntity: Entity = {
  name: 'lists',
  table: 'lists',
  singular: 'list',
  desc: 'What the Notes tab shows: plain lists (items are cards), to-do lists (items are to-dos) and notes (Markdown text).',
  modeScoped: true,
  orderGroup: [],
  filters: ['kind', 'project_id', 'show_today'],
  fields: {
    name: { type: 'text', required: true },
    kind: { type: 'text', enum: LIST_KINDS, default: 'list' },
    project_id: { type: 'text', ref: 'projects', desc: 'Shows the list on that project’s page too' },
    show_today: { type: 'bool', default: false },
    color: { type: 'text' },
  },
  beforeUpdate(_ctx, before, patch) {
    if (patch.kind && patch.kind !== before.kind) throw bad('A list cannot change kind');
  },
  async afterCreate(ctx, row) {
    if (row.kind === 'todo') await create(ctx, columnsEntity, { list_id: row.id, name: 'General' });
    if (row.kind === 'list') await create(ctx, columnsEntity, { list_id: row.id, name: 'Items' });
    if (row.kind === 'note') await setNote(ctx, { list_id: row.id }, '');
  },
};

export const todosEntity: Entity = {
  name: 'todos',
  table: 'todos',
  singular: 'to-do',
  desc: 'One-off small tasks on a to-do list. day empty = anytime; done = the day it was done.',
  modeScoped: true,
  orderGroup: ['list_id', 'group_id'],
  filters: ['list_id', 'group_id', 'day', 'project_id'],
  fields: {
    title: { type: 'text', required: true },
    list_id: { type: 'text', ref: 'lists', cascade: true, desc: 'Defaults to the first to-do list (made if there is none)' },
    group_id: { type: 'text', ref: 'columns', cascade: true, desc: 'A group (column) of the list; defaults to its first' },
    day: { type: 'day' },
    done: { type: 'day' },
    project_id: { type: 'text', ref: 'projects' },
    note: { type: 'markdown' },
    color: { type: 'text' },
  },
  async beforeCreate(ctx, row) {
    if (!row.list_id) row.list_id = (await defaultTodoList(ctx)).id;
    const l = await get(ctx, listsEntity, String(row.list_id));
    if (l.kind !== 'todo') throw bad(`${l.name} is not a to-do list`);
    if (!row.group_id) row.group_id = (await firstColumn(ctx, null, l.id)).id;
  },
  async beforeUpdate(ctx, before, patch) {
    const listId = String(patch.list_id ?? before.list_id);
    if (patch.list_id && patch.list_id !== before.list_id) {
      const l = await get(ctx, listsEntity, listId);
      if (l.kind !== 'todo') throw bad(`${l.name} is not a to-do list`);
      if (!patch.group_id) patch.group_id = (await firstColumn(ctx, null, listId)).id;
    }
    if (patch.group_id) {
      const g = await get(ctx, columnsEntity, String(patch.group_id));
      if (g.list_id !== listId) throw bad('That group is on another list');
    }
  },
};

export async function defaultTodoList(ctx: Ctx): Promise<Row> {
  const lists = await list(ctx, listsEntity, { where: { kind: 'todo' }, limit: 1 });
  return lists[0] ?? create(ctx, listsEntity, { name: 'To-dos', kind: 'todo', show_today: true });
}

/** A list with its contents: board (plain), groups with to-dos (todo) or the Markdown body (note). */
export async function fullList(ctx: Ctx, id: string) {
  const l = await get(ctx, listsEntity, id);
  if (l.kind === 'note') return { ...l, body: (await getNote(ctx, { list_id: id }))?.body ?? '' };
  if (l.kind === 'list') return { ...l, columns: await board(ctx, { list_id: id }) };
  const [groups, todos] = await Promise.all([
    list(ctx, columnsEntity, { where: { list_id: id } }),
    list(ctx, todosEntity, { where: { list_id: id }, limit: 2000 }),
  ]);
  return { ...l, groups: groups.map((g) => ({ ...g, todos: todos.filter((t) => t.group_id === g.id) })) };
}

export async function todosForDay(ctx: Ctx, day: string) {
  // Open to-dos due today or earlier, plus those done today (so a tick does not make them vanish at once).
  return list(ctx, todosEntity, {
    sql: '(day IS NOT NULL AND day <= ? AND done IS NULL) OR done = ?',
    params: [day, day],
    order: 'done IS NOT NULL, day, ord',
  });
}

export const listsModule: Module = {
  id: 'lists',
  description: 'Plain lists, to-do lists, notes and to-dos.',
  entities: [listsEntity, todosEntity],
  routes(api) {
    api.get('/lists/:id/full', async (c) => c.json(await fullList(c.get('ctx'), c.req.param('id'))));
    api.post('/todos/:id/tick', async (c) => {
      const ctx = c.get('ctx');
      ctx.label = 'tick to-do';
      const body = await c.req.json<{ done?: boolean }>().catch(() => ({ done: true }));
      return c.json(await tick(ctx, c.req.param('id'), body.done !== false));
    });
  },
  tools: [
    {
      name: 'list_lists',
      description: 'List the lists, to-do lists and notes of the mode (without their contents).',
      readOnly: true,
      input: z.object({ kind: z.enum(LIST_KINDS).optional() }),
      run: (ctx, a) => list(ctx, listsEntity, { where: a.kind ? { kind: a.kind } : {} }),
    },
    {
      name: 'get_list',
      description: 'A list with its contents: items (plain list), groups and to-dos (to-do list) or Markdown body (note).',
      readOnly: true,
      input: z.object({ id: z.string() }),
      run: (ctx, a) => fullList(ctx, a.id),
    },
    {
      name: 'create_list',
      description: 'Create a plain list (kind "list"), a to-do list ("todo") or a note ("note", with Markdown body). Items can be given at once.',
      input: z.object({
        name: z.string().min(1),
        kind: z.enum(LIST_KINDS).default('list'),
        items: z.array(z.string()).optional().describe('Item titles for a list or to-do list'),
        body: z.string().optional().describe('Markdown body for a note'),
        show_today: z.boolean().optional(),
        project_id: z.string().optional(),
        color: z.string().optional(),
      }),
      run: async (ctx, { items, body, ...a }) => {
        const l = await create(ctx, listsEntity, a);
        for (const title of items ?? []) {
          if (l.kind === 'todo') await create(ctx, todosEntity, { list_id: l.id, title });
          else if (l.kind === 'list') await create(ctx, tasksEntity, { list_id: l.id, title });
        }
        if (body != null && l.kind === 'note') await setNote(ctx, { list_id: l.id }, body);
        return fullList(ctx, l.id);
      },
    },
    {
      name: 'add_todo',
      description: 'Add a to-do. Without list_id it goes on the first to-do list. day (YYYY-MM-DD) makes it due that day; empty means anytime.',
      input: z.object({
        title: z.string().min(1),
        list_id: z.string().optional(),
        group_id: z.string().optional(),
        day: z.string().optional(),
        project_id: z.string().optional(),
        note: z.string().optional(),
      }),
      run: (ctx, a) => create(ctx, todosEntity, a),
    },
    {
      name: 'tick_todo',
      description: 'Mark a to-do done (today) or not done.',
      input: z.object({ id: z.string(), done: z.boolean().default(true) }),
      run: (ctx, a) => tick(ctx, a.id, a.done),
    },
  ],
};

async function tick(ctx: Ctx, id: string, done: boolean) {
  return update(ctx, todosEntity, id, { done: done ? await ctx.today() : null });
}
