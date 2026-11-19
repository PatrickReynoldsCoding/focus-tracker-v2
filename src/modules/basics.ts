// Small modules: modes, categories, backlog, criteria, resources, stickies. (Links: relations.ts.)

import { z } from 'zod';
import type { Entity } from '../core/entity';
import { bad } from '../core/errors';
import { allEntities, type Module } from '../core/registry';
import { create, get, list, remove, update } from '../core/store';
import { projectsEntity } from './projects';

const COLOR = { type: 'text', desc: 'A colour name or #rrggbb' } as const;

function checkColour(v: unknown) {
  if (typeof v === 'string' && v !== '' && !/^#[0-9a-fA-F]{6}$/.test(v)) throw bad('color must look like #3366cc');
}

export const modesEntity: Entity = {
  name: 'modes',
  table: 'modes',
  singular: 'mode',
  desc: 'Separate areas of life with their own data, such as Personal and Work.',
  modeScoped: false,
  orderGroup: [],
  fields: {
    label: { type: 'text', required: true },
    account_id: { type: 'text', ref: 'accounts', desc: 'Google account used for Drive sync' },
    drive_folder_id: { type: 'text' },
    color: { type: 'text', desc: 'Accent colour as #rrggbb, used by the web app while this mode is open' },
  },
  beforeUpdate(_ctx, _before, patch) {
    checkColour(patch.color);
  },
  async onDelete(ctx, row) {
    // A mode can only go when it holds no data (and never the last one).
    const modes = await ctx.db.prepare('SELECT COUNT(*) AS n FROM modes').first<{ n: number }>();
    if ((modes?.n ?? 0) <= 1) throw bad('The last mode cannot be deleted');
    const used: string[] = [];
    for (const e of allEntities()) {
      if (!e.modeScoped) continue;
      const r = await ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${e.table} WHERE mode = ?`).bind(row.id).first<{ n: number }>();
      if (r?.n) used.push(`${r.n} ${r.n === 1 ? e.singular : e.name}`);
    }
    if (used.length) throw bad(`The mode "${row.label}" still has data (${used.join(', ')}). Delete that first.`);
    if ((await ctx.setting('default_mode', '')) === row.id) throw bad('This is the default mode; make another mode the default first');
  },
  beforeCreate(_ctx, row) {
    checkColour(row.color);
    // A mode's id is chosen from its label, so it reads well in URLs: "side-projects".
    if (typeof row.label === 'string' && row.id && /^[a-z0-9]{10}$/.test(String(row.id))) {
      const slug = row.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (slug.length >= 2) row.id = slug.length < 6 ? `${slug}-mode` : slug.slice(0, 40);
    }
  },
};

export const categoriesEntity: Entity = {
  name: 'categories',
  table: 'categories',
  singular: 'category',
  desc: 'Groups of projects, such as Coding, Job search, House.',
  modeScoped: true,
  orderGroup: [],
  fields: {
    label: { type: 'text', required: true },
    color: COLOR,
    account_id: { type: 'text', ref: 'accounts', desc: 'Overrides the mode’s Google account for Drive sync' },
    drive_folder_id: { type: 'text' },
  },
  async onDelete(ctx, row) {
    // A category in use cannot be deleted: say what uses it, so the owner can move those first.
    const parts: string[] = [];
    for (const [table, noun] of [['projects', 'project'], ['backlog', 'backlog item'], ['habits', 'habit'], ['resources', 'resource']] as const) {
      const r = await ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE mode = ? AND category_id = ?`).bind(ctx.mode, row.id).first<{ n: number }>();
      if (r?.n) parts.push(`${r.n} ${noun}${r.n === 1 ? '' : 's'}`);
    }
    if (parts.length) throw bad(`The category "${row.label}" is still used by ${parts.join(', ')}. Move or delete those first.`);
  },
};

export const backlogEntity: Entity = {
  name: 'backlog',
  table: 'backlog',
  singular: 'backlog item',
  desc: 'Projects not started yet, in the order the owner wants them. Starting one turns it into a project.',
  modeScoped: true,
  orderGroup: [],
  filters: ['category_id'],
  fields: {
    title: { type: 'text', required: true },
    category_id: { type: 'text', ref: 'categories' },
    note: { type: 'markdown' },
  },
};

export const criteriaEntity: Entity = {
  name: 'criteria',
  table: 'criteria',
  singular: 'done criterion',
  desc: 'A project’s checklist of what “done” means.',
  modeScoped: true,
  orderGroup: ['project_id'],
  filters: ['project_id', 'done'],
  fields: {
    project_id: { type: 'text', required: true, ref: 'projects', cascade: true },
    text: { type: 'text', required: true },
    done: { type: 'bool', default: false },
  },
};

export const stickiesEntity: Entity = {
  name: 'stickies',
  table: 'stickies',
  singular: 'sticky note',
  desc: 'Sticky notes placed on a project’s page.',
  modeScoped: true,
  filters: ['project_id'],
  fields: {
    project_id: { type: 'text', required: true, ref: 'projects', cascade: true },
    text: { type: 'text' },
    color: COLOR,
    opacity: { type: 'real' },
    x: { type: 'real' },
    y: { type: 'real' },
    w: { type: 'real' },
    h: { type: 'real' },
  },
};

export const basicsModule: Module = {
  id: 'basics',
  description: 'Modes, categories, backlog, done criteria and stickies.',
  entities: [modesEntity, categoriesEntity, backlogEntity, criteriaEntity, stickiesEntity],
  routes(api) {
    // Start a backlog item: it becomes an active project.
    api.post('/backlog/:id/start', async (c) => {
      const ctx = c.get('ctx');
      ctx.label = 'start backlog item';
      return c.json(await startBacklogItem(ctx, c.req.param('id')));
    });
  },
  tools: [
    {
      name: 'start_backlog_item',
      description: 'Turn a backlog item into an active project (the backlog item is removed).',
      input: z.object({ id: z.string() }),
      run: (ctx, a) => startBacklogItem(ctx, a.id),
    },
    {
      name: 'check_criterion',
      description: 'Tick or untick one of a project’s done criteria.',
      input: z.object({ id: z.string(), done: z.boolean().default(true) }),
      run: (ctx, a) => update(ctx, criteriaEntity, a.id, { done: a.done }),
    },
    {
      name: 'list_categories',
      description: 'List the categories of the mode.',
      readOnly: true,
      input: z.object({}),
      run: (ctx) => list(ctx, categoriesEntity),
    },
  ],
};

async function startBacklogItem(ctx: import('../core/ctx').Ctx, id: string) {
  const item = await get(ctx, backlogEntity, id);
  const project = await create(ctx, projectsEntity, {
    name: item.title,
    category_id: item.category_id,
    status: 'active',
  });
  await (await import('./relations')).moveLinks(ctx, { kind: 'backlog', id }, { kind: 'projects', id: project.id });
  await remove(ctx, backlogEntity, id);
  if (item.note) {
    const { setNote } = await import('./notes');
    await setNote(ctx, { project_id: project.id }, String(item.note));
  }
  return project;
}
