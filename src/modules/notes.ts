// Notes: a project's notes, or the text of a list with kind 'note'. Markdown.

import { z } from 'zod';
import type { Ctx } from '../core/ctx';
import type { Entity, Row } from '../core/entity';
import { ApiError, bad } from '../core/errors';
import type { FileItem } from '../core/files';
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

/** A project's notes on Today (the panel `pnote-<project id>`), or off it. Made empty on first use. */
async function projectNoteOnToday(ctx: Ctx, projectId: string, on: boolean) {
  const p = await ctx.db.prepare('SELECT id FROM projects WHERE id = ? AND mode = ?').bind(projectId, ctx.mode).first();
  if (!p) throw new ApiError(404, `No project with id ${projectId}`);
  const note = (await getNote(ctx, { project_id: projectId })) ?? (await setNote(ctx, { project_id: projectId }, ''));
  return update(ctx, notesEntity, String(note.id), { show_today: on });
}

/** Each project's notes as a file in the project's folder (they cannot move). Empty ones show
 *  only in the folder itself, not in searches or the Notes filter. */
async function projectNoteFiles(ctx: Ctx, like: string | null): Promise<FileItem[]> {
  const where = like ? ` AND (p.name LIKE ?2 ESCAPE '\\' OR n.body LIKE ?2 ESCAPE '\\')` : '';
  const rows = await ctx.db
    .prepare(
      `SELECT p.id, p.name, p.created, n.updated_at, n.show_today, substr(n.body, 1, 240) AS preview, length(n.body) AS size
       FROM projects p LEFT JOIN notes n ON n.project_id = p.id WHERE p.mode = ?1${where} LIMIT 2000`,
    )
    .bind(...(like ? [ctx.mode, like] : [ctx.mode]))
    .all<{ id: string; name: string; created: string; updated_at: string | null; show_today: number | null; preview: string | null; size: number | null }>();
  return rows.results.map((r) => ({
    type: 'project-note',
    id: r.id,
    name: `${r.name} notes`,
    folder_id: null,
    project_id: r.id,
    created: r.created,
    updated_at: r.updated_at ?? r.created,
    show_today: r.show_today === 1,
    preview: r.preview,
    quiet: !r.size,
  }));
}

export const notesModule: Module = {
  id: 'notes',
  description: 'Project notes and notes on the Notes tab, as Markdown.',
  entities: [notesEntity],
  files: [{ type: 'project-note', group: 'notes', label: 'Project notes', list: projectNoteFiles, today: { prefix: 'pnote-', set: projectNoteOnToday } }],
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
