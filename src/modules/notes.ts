// Notes: a project's notes, or the text of a list with kind 'note'. Markdown.

import { z } from 'zod';
import type { Ctx } from '../core/ctx';
import type { Entity, Row } from '../core/entity';
import { bad } from '../core/errors';
import type { Module } from '../core/registry';
import { create, list, update } from '../core/store';

export const notesEntity: Entity = {
  name: 'notes',
  table: 'notes',
  singular: 'note',
  desc: 'Markdown text of a project’s notes, or of a note on the Notes tab (a list with kind "note").',
  modeScoped: true,
  filters: ['project_id', 'list_id', 'show_today'],
  fields: {
    project_id: { type: 'text', ref: 'projects', cascade: true },
    list_id: { type: 'text', ref: 'lists', cascade: true },
    body: { type: 'markdown', default: '' },
    show_today: { type: 'bool', default: false },
    today_at: { type: 'time', readonly: true, desc: 'When it was put on Today (Today panels keep that order)' },
  },
  beforeCreate(ctx, row) {
    if (!row.project_id === !row.list_id) throw bad('A note belongs to exactly one of project_id or list_id');
    if (row.show_today) row.today_at = ctx.now();
  },
  beforeUpdate(ctx, before, patch) {
    if (patch.show_today && !before.show_today) patch.today_at = ctx.now();
  },
};

type Owner = { project_id: string } | { list_id: string };

export async function getNote(ctx: Ctx, owner: Owner): Promise<Row | null> {
  return (await list(ctx, notesEntity, { where: owner, limit: 1 }))[0] ?? null;
}

export async function setNote(ctx: Ctx, owner: Owner, body: string, how: 'replace' | 'append' | 'prepend' = 'replace') {
  const existing = await getNote(ctx, owner);
  const old = String(existing?.body ?? '');
  const sep = old && body ? '\n\n' : '';
  const next = how === 'append' ? old + sep + body : how === 'prepend' ? body + sep + old : body;
  if (existing) return update(ctx, notesEntity, existing.id, { body: next });
  return create(ctx, notesEntity, { ...owner, body: next });
}

export const notesModule: Module = {
  id: 'notes',
  description: 'Project notes and notes on the Notes tab, as Markdown.',
  entities: [notesEntity],
  routes(api) {
    api.put('/notes/of/:kind/:id', async (c) => {
      const ctx = c.get('ctx');
      ctx.label = 'edit note';
      const { body } = await c.req.json<{ body: string }>();
      const kind = c.req.param('kind');
      if (typeof body !== 'string') throw bad('body must be text');
      const owner = kind === 'project' ? { project_id: c.req.param('id') } : { list_id: c.req.param('id') };
      return c.json(await setNote(ctx, owner, body));
    });
  },
  tools: [
    {
      name: 'write_note',
      description:
        'Write a project’s notes (project_id) or a note’s text (list_id of a list with kind "note"). Markdown. how: replace (default), append or prepend. To change one part, read the note first, then replace the whole text.',
      input: z.object({
        project_id: z.string().optional(),
        list_id: z.string().optional(),
        body: z.string(),
        how: z.enum(['replace', 'append', 'prepend']).default('replace'),
      }),
      run: (ctx, a) => {
        if (!a.project_id === !a.list_id) throw bad('Give exactly one of project_id or list_id');
        return setNote(ctx, a.project_id ? { project_id: a.project_id } : { list_id: a.list_id! }, a.body, a.how);
      },
    },
    {
      name: 'read_note',
      description: 'Read a project’s notes (project_id) or a note’s text (list_id).',
      readOnly: true,
      input: z.object({ project_id: z.string().optional(), list_id: z.string().optional() }),
      run: async (ctx, a) => {
        if (!a.project_id === !a.list_id) throw bad('Give exactly one of project_id or list_id');
        return (await getNote(ctx, a.project_id ? { project_id: a.project_id } : { list_id: a.list_id! })) ?? { body: '' };
      },
    },
  ],
};
