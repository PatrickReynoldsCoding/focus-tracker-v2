// Small modules: modes, categories, backlog, criteria. (Links: relations.ts, stickies: stickies.ts.)

import { z } from 'zod';
import type { Ctx } from '../core/ctx';
import type { Entity } from '../core/entity';
import { bad } from '../core/errors';
import { allEntities, type Module } from '../core/registry';
import { create, get, list, remove, update } from '../core/store';
import { projectsEntity } from './projects';

const COLOR = { type: 'text', desc: 'A colour name or #rrggbb' } as const;

function checkColour(v: unknown) {
  if (typeof v === 'string' && v !== '' && !/^#[0-9a-fA-F]{6}$/.test(v)) throw bad('color must look like #3366cc');
}

/** Two profiles with the same name would be easy to mix up (and deleting one asks for its name). */
async function checkUniqueLabel(ctx: Ctx, label: unknown, except: string | null) {
  if (typeof label !== 'string') return;
  const clash = await ctx.db.prepare('SELECT id FROM modes WHERE lower(trim(label)) = lower(trim(?)) AND id != ?').bind(label, except ?? '').first();
  if (clash) throw bad(`There is already a profile called ${label.trim()}`);
}

/** An id not used by a profile, nor by a deleted one that can still be restored. */
async function freeModeId(ctx: Ctx, wanted: string): Promise<string> {
  for (let n = 1; ; n++) {
    const id = n === 1 ? wanted : `${wanted.slice(0, 37)}-${n}`;
    const used = await ctx.db.prepare('SELECT 1 FROM modes WHERE id = ?1 UNION SELECT 1 FROM deleted_modes WHERE id = ?1').bind(id).first();
    if (!used) return id;
  }
}

export const modesEntity: Entity = {
  name: 'modes',
  table: 'modes',
  singular: 'mode',
  desc: 'Profiles (the app’s name for modes): separate areas of life with their own data and settings, such as Personal and Work.',
  modeScoped: false,
  orderGroup: [],
  fields: {
    label: { type: 'text', required: true },
    color: { type: 'text', desc: 'Colour theme as #rrggbb, used by the web app while this profile is open' },
    theme: { type: 'text', desc: 'Look of the web app while this profile is open (a theme id such as forest); empty = same as the app' },
  },
  async beforeUpdate(ctx, before, patch) {
    checkColour(patch.color);
    await checkUniqueLabel(ctx, patch.label, String(before.id));
  },
  async onDelete(ctx, row) {
    // The plain delete only takes an empty profile (and never the last one); Manage profiles
    // deletes one with everything in it (profiles.ts).
    const modes = await ctx.db.prepare('SELECT COUNT(*) AS n FROM modes').first<{ n: number }>();
    if ((modes?.n ?? 0) <= 1) throw bad('The last profile cannot be deleted');
    const used: string[] = [];
    for (const e of allEntities()) {
      if (!e.modeScoped) continue;
      const r = await ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${e.table} WHERE mode = ?`).bind(row.id).first<{ n: number }>();
      if (r?.n) used.push(`${r.n} ${r.n === 1 ? e.singular : e.name}`);
    }
    if (used.length) throw bad(`The profile "${row.label}" still has data (${used.join(', ')}). Delete that first, or delete the profile with everything in it (Manage profiles).`);
    if ((await ctx.setting('default_mode', '')) === row.id) throw bad('This is the default profile; make another profile the default first');
  },
  async beforeCreate(ctx, row) {
    checkColour(row.color);
    await checkUniqueLabel(ctx, row.label, null);
    // A profile's id is chosen from its label, so it reads well in URLs: "side-projects".
    if (typeof row.label === 'string' && row.id && /^[a-z0-9]{10}$/.test(String(row.id))) {
      const slug = row.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (slug.length >= 2) row.id = await freeModeId(ctx, slug.length < 6 ? `${slug}-mode` : slug.slice(0, 40));
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

export const basicsModule: Module = {
  id: 'basics',
  description: 'Modes, categories, backlog and done criteria.',
  entities: [modesEntity, categoriesEntity, backlogEntity, criteriaEntity],
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
