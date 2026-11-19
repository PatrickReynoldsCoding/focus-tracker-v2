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
  // Read by the web app's note editor (web/src/features/editor).
  features: [
    {
      id: 'rich-editor',
      label: 'Rich note editor',
      description: 'Notes are edited as formatted text with a toolbar, drafts kept on the device and a choice when two devices change a note. Off: the plain Markdown text box.',
      default: true,
    },
    {
      id: 'paper-themes',
      label: 'Paper themes for notes',
      description: 'Notes can look like a legal pad, grid or dot paper (chosen per device in the editor’s ⋯ menu).',
      default: true,
    },
  ],
  routes(api) {
    const ownerOf = (kind: string, id: string): Owner => (kind === 'project' ? { project_id: id } : { list_id: id });
    // The note with its version (updated_at; null when it has never been written).
    api.get('/notes/of/:kind/:id', async (c) => {
      const n = await getNote(c.get('ctx'), ownerOf(c.req.param('kind'), c.req.param('id')));
      return c.json({ body: String(n?.body ?? ''), updated_at: n?.updated_at ?? null });
    });
    // Write the note. With `base` (the updated_at the edit started from, or null for a new
    // note), the write is refused with 409 when the note changed since, so an editor can
    // offer a choice instead of overwriting another device's (or Claude's) change.
    api.put('/notes/of/:kind/:id', async (c) => {
      const ctx = c.get('ctx');
      ctx.label = 'edit note';
      const { body, base } = await c.req.json<{ body: string; base?: string | null }>();
      if (typeof body !== 'string') throw bad('body must be text');
      if (base !== undefined && base !== null && typeof base !== 'string') throw bad('base must be the note’s updated_at, or null');
      const owner = ownerOf(c.req.param('kind'), c.req.param('id'));
      if (base !== undefined) {
        const now = await getNote(ctx, owner);
        const current = now?.updated_at ?? null;
        if (current !== base && String(now?.body ?? '') !== body)
          return c.json({ error: 'This note was changed somewhere else since you started editing.', code: 'conflict', current: { body: String(now?.body ?? ''), updated_at: current } }, 409);
      }
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
