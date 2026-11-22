// Lists, to-dos and notes: the `lists` table holds each one (D40). A list (kind 'list') and a to-do
// (kind 'todo') are boards of the board engine (src/modules/boards.ts): a to-do has groups, a
// fixed Done column and days; a plain list has columns only. A list can become a to-do (one way:
// convertListToTodo). A note (kind 'note') is Markdown text. The old to-do API lives in todos.ts.

import { z } from 'zod';
import type { Ctx } from '../core/ctx';
import type { Entity } from '../core/entity';
import { bad } from '../core/errors';
import { entity, type Module } from '../core/registry';
import { type FileItem, type FileSource } from '../core/files';
import { create, get, list, remove, update } from '../core/store';
import { board, columnsEntity, makeColumns, tasksEntity, todoDoneColumn } from './boards';
import { getNote, setNote } from './notes';
import { createTodo, readTodos } from './todos';

export const LIST_KINDS = ['list', 'todo', 'note'] as const;

export const listsEntity: Entity = {
  name: 'lists',
  table: 'lists',
  singular: 'list',
  desc: 'What the Files tab shows besides whiteboards and links: plain lists and to-dos (boards whose items are cards; a to-do also has a Done column and days) and notes (Markdown text). A list can become a to-do (convert_list_to_todo), never the other way.',
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
    if (patch.kind && patch.kind !== before.kind && !(converting.has(ctx) && before.kind === 'list' && patch.kind === 'todo'))
      throw bad(before.kind === 'list' && patch.kind === 'todo' ? 'Use convert_list_to_todo (POST /api/lists/:id/convert) to make a list a to-do' : 'A list cannot change kind');
    checkSeconds(patch.seconds);
    if (patch.show_today && !before.show_today) patch.today_at = ctx.now();
  },
  async afterCreate(ctx, row) {
    if (row.kind === 'note') await setNote(ctx, { list_id: row.id }, '');
    else await makeColumns(ctx, { list_id: row.id }, row.kind === 'todo' ? 'todo' : 'list');
  },
};

/** Requests converting a list to a to-do: the one time a list may change kind. */
const converting = new WeakSet<Ctx>();

function checkSeconds(v: unknown) {
  if (v != null && (!Number.isInteger(Number(v)) || Number(v) < 5 || Number(v) > 3600)) throw bad('seconds must be a whole number from 5 to 3600');
}

/**
 * A list with its contents: its board (plain list), its groups with their to-dos (to-do: the old
 * shape; a done to-do shows in the group it was ticked in, and the Done column is not a group;
 * get_board gives the board itself) or the Markdown body (note). `board`: a to-do also gets its
 * board (`columns`, Done last), which the web app's to-do screen draws (D41).
 */
export async function fullList(ctx: Ctx, id: string, opts: { board?: boolean } = {}) {
  const l = await get(ctx, listsEntity, id);
  if (l.kind === 'note') return { ...l, body: (await getNote(ctx, { list_id: id }))?.body ?? '' };
  if (l.kind === 'list') return { ...l, columns: await board(ctx, { list_id: id }) };
  const [groups, todos, columns] = await Promise.all([
    list(ctx, columnsEntity, { where: { list_id: id } }),
    readTodos(ctx, { where: { list_id: id }, limit: 2000 }),
    opts.board ? board(ctx, { list_id: id }) : null,
  ]);
  const out = { ...l, groups: groups.filter((g) => !g.is_done).map((g) => ({ ...g, todos: todos.filter((t) => t.group_id === g.id) })) };
  return columns ? { ...out, columns } : out;
}

/**
 * Make a plain list a to-do (one way): it gets a Done column and days, its items become the
 * to-do's items in the same groups, an item ticked off earlier goes into Done, and links to its
 * items become links to to-dos. Its id, folder, project, place on Today and panels stay.
 */
export async function convertListToTodo(ctx: Ctx, id: string) {
  const l = await get(ctx, listsEntity, id);
  if (l.kind === 'note') throw bad('A note cannot become a to-do');
  if (l.kind === 'todo') return fullList(ctx, id);
  converting.add(ctx);
  try {
    await update(ctx, listsEntity, id, { kind: 'todo' });
  } finally {
    converting.delete(ctx);
  }
  await todoDoneColumn(ctx, id);
  const cards = await list(ctx, tasksEntity, { where: { list_id: id }, limit: 2000 });
  for (const c of cards) if (c.done) await update(ctx, tasksEntity, c.id, { done: c.done });
  await relinkAsTodos(ctx, cards.map((c) => c.id));
  return fullList(ctx, id);
}

/** Links to cards that became to-dos: the same links (same ids), now to kind todos. */
async function relinkAsTodos(ctx: Ctx, ids: string[]) {
  const links = entity('links');
  for (let i = 0; i < ids.length; i += 40) {
    const part = ids.slice(i, i + 40);
    const marks = part.map(() => '?').join(',');
    const rows = await list(ctx, links, {
      sql: `(from_kind = 'tasks' AND from_id IN (${marks})) OR (to_kind = 'tasks' AND to_id IN (${marks}))`,
      params: [...part, ...part],
      limit: 2000,
    });
    for (const r of rows) {
      await remove(ctx, links, r.id);
      const kind = (k: unknown, rid: unknown) => (k === 'tasks' && part.includes(String(rid)) ? 'todos' : k);
      await create(ctx, links, { id: r.id, from_kind: kind(r.from_kind, r.from_id), from_id: r.from_id, type: r.type, to_kind: kind(r.to_kind, r.to_id), to_id: r.to_id, note: r.note });
    }
  }
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
    ctx.db.prepare(`SELECT id, list_id, title, done FROM tasks WHERE list_id IN (${marks}) ORDER BY done IS NOT NULL, ord`).bind(...ids).all<{ id: string; list_id: string; title: string; done: string | null }>(),
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
        ? { join: 'LEFT JOIN (SELECT list_id, MAX(updated_at) AS u, SUM(done IS NULL) AS n FROM tasks WHERE mode = ?1 AND list_id IS NOT NULL GROUP BY list_id) x ON x.list_id = l.id', cols: 'x.u AS inner_at, NULL AS preview, x.n AS count', search: '' }
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

/** A note, list or to-do list on Today is the panel `list-<id>` (show_today on the row). */
const listOnToday = { prefix: 'list-', set: (ctx: Ctx, id: string, on: boolean) => update(ctx, listsEntity, id, { show_today: on }) };
const listFileSources: FileSource[] = [
  { type: 'note', group: 'notes', label: 'Note', entity: 'lists', list: (ctx, like) => listFiles(ctx, 'note', like), today: listOnToday },
  { type: 'todo', group: 'lists', label: 'To-do list', entity: 'lists', list: (ctx, like) => listFiles(ctx, 'todo', like), today: listOnToday },
  { type: 'list', group: 'lists', label: 'List', entity: 'lists', list: (ctx, like) => listFiles(ctx, 'list', like), today: listOnToday },
];

export const listsModule: Module = {
  id: 'lists',
  description: 'Plain lists, to-dos and notes.',
  entities: [listsEntity],
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
    api.get('/lists/:id/full', async (c) => c.json(await fullList(c.get('ctx'), c.req.param('id'), { board: true })));
    api.post('/lists/:id/convert', async (c) => {
      const ctx = c.get('ctx');
      ctx.label = 'make list a to-do';
      await convertListToTodo(ctx, c.req.param('id'));
      return c.json(await fullList(ctx, c.req.param('id'), { board: true }));
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
          if (l.kind === 'todo') await createTodo(ctx, { list_id: l.id, title });
          else if (l.kind === 'list') await create(ctx, tasksEntity, { list_id: l.id, title });
        }
        if (body != null && l.kind === 'note') await setNote(ctx, { list_id: l.id }, body);
        return fullList(ctx, l.id);
      },
    },
    {
      name: 'convert_list_to_todo',
      description:
        'Make a plain list a to-do: it gets a Done column and days (due dates); its items become to-dos in the same columns (groups). One way: a to-do cannot become a plain list. Its id, folder, project and place on Today stay.',
      input: z.object({ id: z.string() }),
      run: (ctx, a) => convertListToTodo(ctx, a.id),
    },
  ],
};
