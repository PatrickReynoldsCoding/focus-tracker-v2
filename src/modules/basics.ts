// Small modules: modes, categories, backlog, criteria, resources, links, stickies.

import { z } from 'zod';
import type { Entity } from '../core/entity';
import { bad } from '../core/errors';
import type { Module } from '../core/registry';
import { create, get, list, remove, update } from '../core/store';
import { projectsEntity } from './projects';

const COLOR = { type: 'text', desc: 'A colour name or #rrggbb' } as const;

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
  },
  beforeCreate(_ctx, row) {
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

export const resourcesEntity: Entity = {
  name: 'resources',
  table: 'resources',
  singular: 'resource',
  desc: 'Links and contact details kept with a project, or shared by a category. Never store anything sensitive (bank details, passwords, ID numbers).',
  modeScoped: true,
  orderGroup: ['project_id', 'category_id'],
  filters: ['project_id', 'category_id', 'type', 'grp'],
  fields: {
    title: { type: 'text', required: true },
    type: { type: 'text', enum: ['link', 'drive', 'phone', 'email', 'text'], default: 'link' },
    value: { type: 'text', required: true, desc: 'The address, number or text' },
    grp: { type: 'text', desc: 'Free-text group such as "Code" or "Suppliers"' },
    note: { type: 'text' },
    project_id: { type: 'text', ref: 'projects', cascade: true, desc: 'Empty means shared by the category' },
    category_id: { type: 'text', ref: 'categories', cascade: true },
  },
  beforeCreate(_ctx, row) {
    if (!row.project_id && !row.category_id) throw bad('A resource needs project_id or category_id');
    if (row.type === 'link' && typeof row.value === 'string' && /^https:\/\/(docs|drive)\.google\.com\//.test(row.value)) row.type = 'drive';
  },
};

export const linksEntity: Entity = {
  name: 'links',
  table: 'links',
  singular: 'link',
  desc: 'A typed link between two projects. "blocks": from must be done before to starts.',
  modeScoped: true,
  filters: ['from_id', 'to_id', 'type'],
  fields: {
    from_id: { type: 'text', required: true, ref: 'projects', cascade: true },
    to_id: { type: 'text', required: true, ref: 'projects', cascade: true },
    type: { type: 'text', enum: ['blocks', 'relates'], default: 'relates' },
    note: { type: 'text' },
  },
  beforeCreate(_ctx, row) {
    if (row.from_id === row.to_id) throw bad('A project cannot link to itself');
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
  description: 'Modes, categories, backlog, done criteria, resources, project links and stickies.',
  entities: [modesEntity, categoriesEntity, backlogEntity, criteriaEntity, resourcesEntity, linksEntity, stickiesEntity],
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
    next_action: null,
  });
  await remove(ctx, backlogEntity, id);
  if (item.note) {
    const { setNote } = await import('./notes');
    await setNote(ctx, { project_id: project.id }, String(item.note));
  }
  return project;
}
