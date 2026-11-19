// Lists (plain lists, to-do lists, notes) and to-dos.

import { z } from 'zod';
import type { Ctx } from '../core/ctx';
import type { Entity, Row } from '../core/entity';
import { bad } from '../core/errors';
import { type FileItem, type FileSource } from '../core/files';
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
  filters: ['kind', 'project_id', 'show_today', 'folder_id'],
  fields: {
    name: { type: 'text', required: true },
    kind: { type: 'text', enum: LIST_KINDS, default: 'list' },
    project_id: { type: 'text', ref: 'projects', desc: 'Shows the list on that project’s page too (and puts it in the project’s folder)' },
    folder_id: { type: 'text', ref: 'folders', desc: 'The Files folder it is in (empty: top level). A project’s folder makes it that project’s list' },
    show_today: { type: 'bool', default: false },
    color: { type: 'text' },
    display: { type: 'text', enum: ['full', 'one'], default: 'full', desc: 'On Today: the whole list ("full") or one random item at a time ("one")' },
    seconds: { type: 'int', default: 30, desc: 'With display "one": seconds before the next item (5 to 3600)' },
    today_at: { type: 'time', readonly: true, desc: 'When it was put on Today (Today panels keep that order)' },
  },
  beforeCreate(ctx, row) {
    checkSeconds(row.seconds);
    if (row.show_today) row.today_at = ctx.now();
  },
  beforeUpdate(ctx, before, patch) {
    if (patch.kind && patch.kind !== before.kind) throw bad('A list cannot change kind');
    checkSeconds(patch.seconds);
    if (patch.show_today && !before.show_today) patch.today_at = ctx.now();
  },
  async afterCreate(ctx, row) {
    if (row.kind === 'todo') await create(ctx, columnsEntity, { list_id: row.id, name: 'General' });
    if (row.kind === 'list') await create(ctx, columnsEntity, { list_id: row.id, name: 'Items' });
    if (row.kind === 'note') await setNote(ctx, { list_id: row.id }, '');
  },
};

function checkSeconds(v: unknown) {
  if (v != null && (!Number.isInteger(Number(v)) || Number(v) < 5 || Number(v) > 3600)) throw bad('seconds must be a whole number from 5 to 3600');
}

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

/** Every list with a short preview, for the Notes tab's cards (one request, not one per card). */
export async function overview(ctx: Ctx) {
  const lists = await list(ctx, listsEntity);
  const ids = lists.map((l) => l.id);
  if (!ids.length) return [];
  const marks = ids.map(() => '?').join(',');
  const today = await ctx.today();
  const [cards, todos, notes] = await Promise.all([
    ctx.db.prepare(`SELECT list_id, title FROM tasks WHERE list_id IN (${marks}) ORDER BY ord`).bind(...ids).all<{ list_id: string; title: string }>(),
    ctx.db.prepare(`SELECT id, list_id, title, done FROM todos WHERE list_id IN (${marks}) ORDER BY done IS NOT NULL, ord`).bind(...ids).all<{ id: string; list_id: string; title: string; done: string | null }>(),
    ctx.db.prepare(`SELECT list_id, substr(body, 1, 300) AS preview FROM notes WHERE list_id IN (${marks})`).bind(...ids).all<{ list_id: string; preview: string }>(),
  ]);
  return lists.map((l) => {
    if (l.kind === 'note') return { ...l, preview: notes.results.find((n) => n.list_id === l.id)?.preview ?? '' };
    if (l.kind === 'todo') {
      const mine = todos.results.filter((t) => t.list_id === l.id);
      const open = mine.filter((t) => !t.done);
      // Open to-dos first, then those ticked today (so a tick on a card does not make the line vanish).
      const doneToday = mine.filter((t) => t.done === today);
      return { ...l, open: open.length, done_today: doneToday.length, items: [...open.slice(0, 6), ...doneToday.slice(0, 3)] };
    }
    const mine = cards.results.filter((c) => c.list_id === l.id);
    return { ...l, count: mine.length, items: mine.slice(0, 6).map((c) => ({ title: c.title })) };
  });
}

const PROJECT_NOTES_KEY = 'notes.project_cards';

/** Project notes as cards on the Notes tab: a per-mode switch, and (while it is on) the notes with text. */
export async function projectNoteCards(ctx: Ctx) {
  const on = (await ctx.setting(PROJECT_NOTES_KEY)) === '1';
  if (!on) return { on, notes: [] };
  const rows = await ctx.db
    .prepare(
      `SELECT p.id AS project_id, p.name, n.show_today, substr(n.body, 1, 300) AS preview FROM notes n JOIN projects p ON p.id = n.project_id
       WHERE n.mode = ? AND n.project_id IS NOT NULL AND n.body != '' AND p.status = 'active' ORDER BY n.updated_at DESC`,
    )
    .bind(ctx.mode)
    .all<{ project_id: string; name: string; show_today: number; preview: string }>();
  return { on, notes: rows.results.map((r) => ({ ...r, show_today: !!r.show_today })) };
}

/** Lists of one kind as files (the Files tab): a note with its first lines, a list with its item count,
 *  a to-do list with its open to-dos; last changed counts what is inside. */
async function listFiles(ctx: Ctx, kind: (typeof LIST_KINDS)[number], like: string | null): Promise<FileItem[]> {
  const inner =
    kind === 'note'
      ? { join: 'LEFT JOIN notes x ON x.list_id = l.id', cols: 'x.updated_at AS inner_at, substr(x.body, 1, 240) AS preview, NULL AS count', search: ` OR x.body LIKE ?3 ESCAPE '\\'` }
      : kind === 'todo'
        ? { join: 'LEFT JOIN (SELECT list_id, MAX(updated_at) AS u, SUM(done IS NULL) AS n FROM todos WHERE mode = ?1 GROUP BY list_id) x ON x.list_id = l.id', cols: 'x.u AS inner_at, NULL AS preview, x.n AS count', search: '' }
        : { join: 'LEFT JOIN (SELECT list_id, MAX(updated_at) AS u, COUNT(*) AS n FROM tasks WHERE mode = ?1 AND list_id IS NOT NULL GROUP BY list_id) x ON x.list_id = l.id', cols: 'x.u AS inner_at, NULL AS preview, x.n AS count', search: '' };
  const where = like ? ` AND (l.name LIKE ?3 ESCAPE '\\'${inner.search})` : '';
  const rows = await ctx.db
    .prepare(`SELECT l.id, l.name, l.folder_id, l.project_id, l.show_today, l.created, l.updated_at, ${inner.cols} FROM lists l ${inner.join} WHERE l.mode = ?1 AND l.kind = ?2${where} LIMIT 2000`)
    .bind(...(like ? [ctx.mode, kind, like] : [ctx.mode, kind]))
    .all<{ id: string; name: string; folder_id: string | null; project_id: string | null; show_today: number; created: string; updated_at: string; inner_at: string | null; preview: string | null; count: number | null }>();
  return rows.results.map((r) => ({
    type: kind,
    id: r.id,
    name: r.name,
    folder_id: r.folder_id,
    project_id: r.project_id,
    show_today: r.show_today === 1,
    created: r.created,
    updated_at: r.inner_at && r.inner_at > r.updated_at ? r.inner_at : r.updated_at,
    preview: r.preview,
    count: r.count ?? 0,
  }));
}

const listFileSources: FileSource[] = [
  { type: 'note', group: 'notes', label: 'Note', entity: 'lists', list: (ctx, like) => listFiles(ctx, 'note', like) },
  { type: 'todo', group: 'lists', label: 'To-do list', entity: 'lists', list: (ctx, like) => listFiles(ctx, 'todo', like) },
  { type: 'list', group: 'lists', label: 'List', entity: 'lists', list: (ctx, like) => listFiles(ctx, 'list', like) },
];

export const listsModule: Module = {
  id: 'lists',
  description: 'Plain lists, to-do lists, notes and to-dos.',
  entities: [listsEntity, todosEntity],
  files: listFileSources,
  routes(api) {
    api.get('/lists/overview', async (c) => c.json(await overview(c.get('ctx'))));
    api.get('/lists/project-notes', async (c) => c.json(await projectNoteCards(c.get('ctx'))));
    api.put('/lists/project-notes', async (c) => {
      const ctx = c.get('ctx');
      const b = await c.req.json<{ on?: unknown }>().catch(() => ({}) as { on?: unknown });
      if (typeof b.on !== 'boolean') throw bad('Send {"on": true} or {"on": false}');
      await ctx.setSetting(PROJECT_NOTES_KEY, b.on ? '1' : null);
      return c.json(await projectNoteCards(ctx));
    });
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
        folder_id: z.string().optional().describe('The Files folder to put it in'),
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
