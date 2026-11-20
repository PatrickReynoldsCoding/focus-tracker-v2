// Projects, their Kanban boards (columns and cards) and the full project view.

import { z } from 'zod';
import type { Ctx } from '../core/ctx';
import type { Entity, Row } from '../core/entity';
import { bad } from '../core/errors';
import { entity, type Module } from '../core/registry';
import { create, get, list, move, update } from '../core/store';

export const PROJECT_STATUS = ['active', 'paused', 'done', 'dropped'] as const;
/** A new board's columns; the last is its fixed Done column (D34). */
export const DEFAULT_COLUMNS = ['To do', 'Doing', 'Done'];
/** Flag: every project has one fixed Done column, always last; a card is done exactly when it is in it (src/modules/done-column.ts). */
export const DONE_FLAG = 'done-column';

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
    for (const [i, name] of DEFAULT_COLUMNS.entries()) await create(ctx, columnsEntity, { project_id: row.id, name, is_done: i === DEFAULT_COLUMNS.length - 1 });
  },
};

export const columnsEntity: Entity = {
  name: 'columns',
  table: 'columns',
  singular: 'column',
  desc: 'Columns of a project’s Kanban board, of a plain list, or groups of a to-do list.',
  modeScoped: true,
  orderGroup: ['project_id', 'list_id'],
  filters: ['project_id', 'list_id'],
  fields: {
    name: { type: 'text', required: true },
    project_id: { type: 'text', ref: 'projects', cascade: true },
    list_id: { type: 'text', ref: 'lists', cascade: true },
    is_done: { type: 'bool', default: false, desc: 'The project’s fixed Done status: one per board, always last, cannot be deleted; a card is done exactly while it is in it' },
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
  desc: 'Kanban cards on a project board, and items of plain lists. The note is Markdown.',
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
    done: { type: 'day', desc: 'The day it was done. A project card is done exactly while it is in its board’s Done column: setting done moves it there, clearing it moves it out' },
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
    // On, src/modules/done-column.ts keeps done in step with the Done column for every card.
    if (patch.column_id && !(await ctx.feature(DONE_FLAG)) && patch.column_id !== before.column_id && before.project_id && (patch.day ?? before.day) && !('done' in patch)) {
      const last = await doneColumn(ctx, String(before.project_id));
      if (last) patch.done = patch.column_id === last.id ? (before.done ?? (await ctx.today())) : null;
    }
  },
};

/**
 * The column that means done on a project's board: its Done column (made if it has none), or,
 * with the flag done-column off, its last column when it has two or more.
 */
export async function doneColumn(ctx: Ctx, projectId: string): Promise<Row | null> {
  const cols = await list(ctx, columnsEntity, { where: { project_id: projectId } });
  if (await ctx.feature(DONE_FLAG)) return cols.find((c) => c.is_done) ?? (await create(ctx, columnsEntity, { project_id: projectId, name: 'Done', is_done: true }));
  return cols.length > 1 ? cols[cols.length - 1] : null;
}

/**
 * The first column of a board that is not its Done column, making To do / Doing / Done if it has
 * none (or To do, if it has only a Done column).
 */
export async function firstColumn(ctx: Ctx, projectId: string | null, listId: string | null): Promise<Row> {
  if (listId) {
    const cols = await list(ctx, columnsEntity, { where: { list_id: listId }, limit: 1 });
    return cols[0] ?? create(ctx, columnsEntity, { list_id: listId, name: 'Items' });
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

/** Find a column of a board by name (case-insensitive). */
async function columnByName(ctx: Ctx, where: Record<string, unknown>, name: string): Promise<Row> {
  const cols = await list(ctx, columnsEntity, { where });
  const c = cols.find((x) => String(x.name).toLowerCase() === name.trim().toLowerCase());
  if (!c) throw bad(`No column "${name}". Columns: ${cols.map((x) => x.name).join(', ')}`);
  return c;
}

/** A board's columns (statuses) with their cards; each card says its status (its column's name). The Done column is last. */
export async function board(ctx: Ctx, where: { project_id?: string; list_id?: string }) {
  const [cols, cards, on] = await Promise.all([
    list(ctx, columnsEntity, { where }),
    list(ctx, tasksEntity, { where, limit: 2000 }),
    ctx.feature(DONE_FLAG),
  ]);
  if (on) cols.sort((a, b) => Number(!!a.is_done) - Number(!!b.is_done));
  return cols.map((c) => ({ ...c, cards: cards.filter((t) => t.column_id === c.id).map((t) => ({ ...t, status: c.name })) }));
}

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
  const one = async (kind: string, cols: string[], label: string) =>
    (
      await list(ctx, entity(kind), {
        sql: cols.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR '),
        params: cols.map(() => like),
        limit,
      })
    ).map((r) => ({ kind, id: r.id, title: String(r[label] ?? ''), project_id: r.project_id ?? null, list_id: r.list_id ?? null }));
  const groups = await Promise.all([
    one('projects', ['name'], 'name'),
    one('tasks', ['title', 'note'], 'title'),
    one('lists', ['name'], 'name'),
    one('todos', ['title', 'note'], 'title'),
    one('notes', ['body'], 'id'),
    one('backlog', ['title', 'note'], 'title'),
    one('resources', ['title', 'value', 'note'], 'title'),
    one('habits', ['name', 'description'], 'name'),
  ]);
  return groups.flat().slice(0, limit);
}

const cardInput = {
  title: z.string().min(1),
  note: z.string().optional().describe('Markdown'),
  color: z.string().optional(),
};

export const projectsModule: Module = {
  id: 'projects',
  description: 'Projects and their Kanban boards.',
  entities: [projectsEntity, columnsEntity, tasksEntity],
  routes(api) {
    api.get('/projects/:id/full', async (c) => c.json(await fullProject(c.get('ctx'), c.req.param('id'))));
    api.get('/boards/:kind/:id', async (c) => {
      const kind = c.req.param('kind');
      if (kind !== 'project' && kind !== 'list') throw bad('Board kind is project or list');
      return c.json(await board(c.get('ctx'), kind === 'project' ? { project_id: c.req.param('id') } : { list_id: c.req.param('id') }));
    });
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
      name: 'add_card',
      description: 'Add a Kanban card to a project board (or an item to a plain list). Give column_id, or a column (status) name, or neither for the first column. A card added to Done is done.',
      input: z.object({
        project_id: z.string().optional(),
        list_id: z.string().optional(),
        column_id: z.string().optional(),
        column: z.string().optional().describe('Column (status) name, instead of column_id'),
        ...cardInput,
      }),
      run: async (ctx, { column, ...a }) => {
        if (column && !a.column_id) {
          const where = a.project_id ? { project_id: a.project_id } : { list_id: a.list_id };
          a.column_id = (await columnByName(ctx, where, column)).id;
        }
        return create(ctx, tasksEntity, a);
      },
    },
    {
      name: 'update_card',
      description:
        'Edit a card’s title, Markdown note or colour, or its status: a column name of its board (it moves to the end of that column), or done true (into the Done column) / false (back to the first column).',
      input: z.object({
        id: z.string(),
        title: z.string().optional(),
        note: z.string().nullable().optional(),
        color: z.string().nullable().optional(),
        status: z.string().optional().describe('Column name on the same board'),
        done: z.boolean().optional(),
      }),
      run: async (ctx, { id, status, done, ...fields }) => {
        const card = await get(ctx, tasksEntity, id);
        const patch: Record<string, unknown> = { ...fields };
        if (status) {
          const where = card.project_id ? { project_id: card.project_id } : { list_id: card.list_id };
          const col = await columnByName(ctx, where, status);
          if (col.id !== card.column_id) await move(ctx, tasksEntity, id, { column_id: col.id });
        } else if (done !== undefined) {
          // A project card moves into or out of its Done column (that sets done); a plain list's item only records the day.
          if (card.project_id && (await doneColumn(ctx, String(card.project_id)))) {
            const col = done ? await doneColumn(ctx, String(card.project_id)) : await firstColumn(ctx, String(card.project_id), null);
            if (col && col.id !== card.column_id) await move(ctx, tasksEntity, id, { column_id: col.id });
          }
          patch.done = done ? (card.done ?? (await ctx.today())) : null;
        }
        return update(ctx, tasksEntity, id, patch);
      },
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
      run: async (ctx, { id, column, ...t }) => {
        if (column && !t.column_id) {
          const card = await get(ctx, tasksEntity, id);
          const where = card.project_id ? { project_id: card.project_id } : { list_id: card.list_id };
          t.column_id = (await columnByName(ctx, where, column)).id;
        }
        return move(ctx, tasksEntity, id, t);
      },
    },
    {
      name: 'get_board',
      description: 'The columns (statuses) and cards of a project board or plain list. is_done marks a project’s fixed Done column, always last.',
      readOnly: true,
      input: z.object({ project_id: z.string().optional(), list_id: z.string().optional() }),
      run: (ctx, a) => board(ctx, a.project_id ? { project_id: a.project_id } : { list_id: a.list_id }),
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
