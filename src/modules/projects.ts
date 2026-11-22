// Projects and the full project view. A project's board (columns and cards) is a board of
// src/modules/boards.ts, the same engine as to-dos and lists (D40).

import { z } from 'zod';
import type { Ctx } from '../core/ctx';
import type { Entity } from '../core/entity';
import { entity, type Module } from '../core/registry';
import { create, get, list, update, type ListOptions } from '../core/store';
import { board, makeColumns } from './boards';
import { readTodos } from './todos';

export const PROJECT_STATUS = ['active', 'paused', 'done', 'dropped'] as const;

export const projectsEntity: Entity = {
  name: 'projects',
  table: 'projects',
  singular: 'project',
  desc: 'Projects the owner works on, one focus project per day.',
  modeScoped: true,
  orderGroup: [],
  filters: ['category_id', 'status'],
  sort: 'ord, created',
  fields: {
    name: { type: 'text', required: true },
    category_id: { type: 'text', ref: 'categories' },
    status: { type: 'text', enum: PROJECT_STATUS, default: 'active' },
    locked_until: { type: 'day', desc: 'Not offered as focus before this day' },
    last_touched: { type: 'day' },
    hide_done: { type: 'bool', default: false, desc: 'Fold the board’s Done column into a slim strip (with its count), so finished cards do not clutter the board' },
  },
  beforeCreate(ctx, row) {
    row.last_touched ??= ctx.nowDate.toISOString().slice(0, 10);
  },
  async afterCreate(ctx, row) {
    await makeColumns(ctx, { project_id: row.id }, 'project');
  },
};

/** Everything about one project, for its page and for Claude. */
export async function fullProject(ctx: Ctx, id: string) {
  const project = await get(ctx, projectsEntity, id);
  const where = { project_id: id };
  const [columns, criteria, resources, notes, whiteboards, lists, links, log] = await Promise.all([
    board(ctx, where),
    list(ctx, entity('criteria'), { where }),
    list(ctx, entity('resources'), { where }),
    list(ctx, entity('notes'), { where }),
    list(ctx, entity('whiteboards'), { where, order: 'ord' }),
    list(ctx, entity('lists'), { where }),
    import('./relations').then((m) => m.projectRelations(ctx, id)),
    list(ctx, entity('log'), { where, order: 'date DESC, created DESC', limit: 10 }),
  ]);
  return { ...project, columns, criteria, resources, notes: notes[0]?.body ?? '', whiteboards, lists, links: links.links, blocked_by: links.blocked_by, recent_log: log };
}

export async function searchAll(ctx: Ctx, q: string, limit = 30) {
  const like = `%${q.replace(/[%_]/g, (m) => '\\' + m)}%`;
  // A to-do's items are cards, found as to-dos (kind todos), as before (D40); other cards as cards.
  const NOT_TODO = "(list_id IS NULL OR list_id NOT IN (SELECT id FROM lists WHERE kind = 'todo'))";
  const one = async (kind: string, cols: string[], label: string, extra?: string) => {
    const read = kind === 'todos' ? readTodos : (c: Ctx, o: ListOptions) => list(c, entity(kind), o);
    const text = cols.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ');
    return (await read(ctx, { sql: extra ? `(${text}) AND ${extra}` : text, params: cols.map(() => like), limit })).map((r) => ({
      kind,
      id: r.id,
      title: String(r[label] ?? ''),
      project_id: r.project_id ?? null,
      list_id: r.list_id ?? null,
    }));
  };
  const groups = await Promise.all([
    one('projects', ['name'], 'name'),
    one('tasks', ['title', 'note'], 'title', NOT_TODO),
    one('lists', ['name'], 'name'),
    one('todos', ['title', 'note'], 'title'),
    one('notes', ['body'], 'id'),
    one('backlog', ['title', 'note'], 'title'),
    one('resources', ['title', 'value', 'note'], 'title'),
    one('habits', ['name', 'description'], 'name'),
  ]);
  return groups.flat().slice(0, limit);
}

export const projectsModule: Module = {
  id: 'projects',
  description: 'Projects and their Kanban boards.',
  entities: [projectsEntity],
  routes(api) {
    api.get('/projects/:id/full', async (c) => c.json(await fullProject(c.get('ctx'), c.req.param('id'))));
    api.get('/search', async (c) => c.json(await searchAll(c.get('ctx'), c.req.query('q') ?? '')));
  },
  tools: [
    {
      name: 'list_projects',
      description: 'List projects in the mode, optionally filtered by status, category or a text search on the name.',
      readOnly: true,
      input: z.object({
        status: z.enum(PROJECT_STATUS).optional(),
        category_id: z.string().optional(),
        search: z.string().optional(),
      }),
      run: async (ctx, a) => {
        const where: Record<string, unknown> = {};
        if (a.status) where.status = a.status;
        if (a.category_id) where.category_id = a.category_id;
        const opts = a.search ? { where, sql: 'name LIKE ?', params: [`%${a.search}%`] } : { where };
        return list(ctx, projectsEntity, opts);
      },
    },
    {
      name: 'get_project',
      description: 'Everything about one project: board (columns are statuses, is_done marks the Done column; hide_done folds it on the board) with cards (each with its status), done criteria, notes (Markdown), resources, lists, whiteboards, links (each with its phrase, such as "is blocked by"), blocked_by (unfinished items blocking it) and recent sessions.',
      readOnly: true,
      input: z.object({ id: z.string() }),
      run: (ctx, a) => fullProject(ctx, a.id),
    },
    {
      name: 'create_project',
      description: 'Create a project. It gets a board with To do, Doing and Done statuses (columns); Done is fixed and always last.',
      input: z.object({
        name: z.string().min(1),
        category_id: z.string().optional(),
        status: z.enum(PROJECT_STATUS).optional(),
        notes: z.string().optional().describe('Markdown notes for the project'),
      }),
      run: async (ctx, { notes, ...a }) => {
        const p = await create(ctx, projectsEntity, a);
        if (notes) await (await import('./notes')).setNote(ctx, { project_id: p.id }, notes);
        return fullProject(ctx, p.id);
      },
    },
    {
      name: 'update_project',
      description: 'Change a project’s name, status, category, locked_until, or hide_done (fold the board’s Done column into a slim strip, on every device).',
      input: z.object({
        id: z.string(),
        hide_done: z.boolean().optional(),
        name: z.string().optional(),
        status: z.enum(PROJECT_STATUS).optional(),
        category_id: z.string().nullable().optional(),
        locked_until: z.string().nullable().optional(),
      }),
      run: (ctx, { id, ...patch }) => update(ctx, projectsEntity, id, patch),
    },
    {
      name: 'search',
      description: 'Search projects, cards, lists, to-dos, notes, backlog, resources and habits by text.',
      readOnly: true,
      input: z.object({ query: z.string().min(1), limit: z.number().int().max(100).optional() }),
      run: (ctx, a) => searchAll(ctx, a.query, a.limit),
    },
  ],
};
