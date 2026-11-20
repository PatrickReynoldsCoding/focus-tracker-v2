// Whiteboards: Excalidraw drawings, on a project or on their own (V1-GAPS 37).
// The board row (name, project, show on Today, a small preview) is an ordinary entity, so lists,
// renames, moves and deletes go through the generic store with undo. The drawing itself lives in
// whiteboard_scenes (migration 0012): lists never read it, and it is fetched and saved through
// GET / PUT /api/whiteboards/:id/scene. Saving a drawing is not undoable (the editor's own undo
// and "Close without saving" cover it, as in v1); deleting a board deletes its drawing in the
// same undo step, so Undo brings both back.

import { z } from 'zod';
import type { Ctx } from '../core/ctx';
import type { Entity } from '../core/entity';
import { ApiError, bad } from '../core/errors';
import { requireFeature } from '../core/features';
import type { FileItem } from '../core/files';
import type { Module } from '../core/registry';
import { create, get, getRaw, remove, update } from '../core/store';

export const FLAG = 'whiteboards';

/** The most a drawing may take, as stored (UTF-8). D1 allows about 2 MB per row, and deleting a
 *  board copies the drawing (escaped once more) into the undo history, so leave room for that. */
export const MAX_SCENE_BYTES = 1_500_000;
const MAX_ESCAPED_BYTES = 1_900_000;
/** A preview is a small data: URL (the browser aims for under 45,000 characters). */
export const MAX_THUMBNAIL = 60_000;
const THUMB_RE = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/]+=*$/;

const bytes = (s: string) => new TextEncoder().encode(s).length;
const mb = (n: number) => `${(n / 1_000_000).toFixed(1)} MB`;

function checkThumbnail(v: unknown) {
  if (v == null || v === '') return;
  if (typeof v !== 'string' || !THUMB_RE.test(v)) throw bad('thumbnail must be a data:image/webp, jpeg or png base64 address');
  if (v.length > MAX_THUMBNAIL) throw bad(`thumbnail is too big (${v.length} characters, at most ${MAX_THUMBNAIL})`);
}

export const whiteboardScenesEntity: Entity = {
  name: 'whiteboard_scenes',
  table: 'whiteboard_scenes',
  singular: 'whiteboard drawing',
  desc: 'The Excalidraw drawing of a whiteboard (same id as the board). Read it with get_whiteboard.',
  modeScoped: true,
  internal: true,
  fields: {
    scene: { type: 'text', desc: 'Excalidraw scene JSON' },
  },
};

export const whiteboardsEntity: Entity = {
  name: 'whiteboards',
  table: 'whiteboards',
  singular: 'whiteboard',
  desc: 'Excalidraw whiteboards, on a project or on their own. The drawing is not in this row: use get_whiteboard and create_whiteboard.',
  modeScoped: true,
  orderGroup: [],
  filters: ['project_id', 'show_today', 'folder_id'],
  sort: 'updated_at DESC',
  fields: {
    name: { type: 'text', required: true },
    project_id: { type: 'text', ref: 'projects', cascade: true, desc: 'Empty means a board of its own' },
    folder_id: { type: 'text', ref: 'folders', desc: 'The Files folder it is in (empty: top level). A project’s folder makes it that project’s board' },
    show_today: { type: 'bool', default: false, desc: 'Shown on Today as a preview' },
    thumbnail: { type: 'text', desc: 'Small data:image preview, made by the web app when the board is saved' },
  },
  beforeCreate(_ctx, row) {
    checkThumbnail(row.thumbnail);
  },
  beforeUpdate(_ctx, _before, patch) {
    checkThumbnail(patch.thumbnail);
  },
  async onDelete(ctx, row) {
    // The drawing goes in the same undo step, so Undo brings it back with the board.
    if (await getRaw(ctx, whiteboardScenesEntity, row.id)) await remove(ctx, whiteboardScenesEntity, row.id);
  },
};

/** Check a drawing and turn it into the stored text. Throws a clear 413 when it is too big. */
export function sceneText(scene: unknown): string {
  if (!scene || typeof scene !== 'object' || Array.isArray(scene)) throw bad('scene must be an Excalidraw scene object');
  const s = scene as Record<string, unknown>;
  if (!Array.isArray(s.elements)) throw bad('scene.elements must be a list of Excalidraw elements');
  if (s.files != null && (typeof s.files !== 'object' || Array.isArray(s.files))) throw bad('scene.files must be an object');
  const text = JSON.stringify({ type: 'excalidraw', version: 2, source: 'focus-tracker', ...s });
  const size = bytes(text);
  if (size > MAX_SCENE_BYTES || bytes(JSON.stringify(text)) > MAX_ESCAPED_BYTES) {
    throw new ApiError(413, `This drawing is too big to save (${mb(size)}; the limit is ${mb(MAX_SCENE_BYTES)}). Remove some images or drawings and try again.`, 'too_big');
  }
  return text;
}

/** Write a drawing. Not undoable unless `undoable` (a new board made by Claude: undoing the board removes it too). */
async function writeScene(ctx: Ctx, id: string, text: string, opts: { thumbnail?: string | null; undoable?: boolean; viewOnly?: boolean } = {}) {
  const now = ctx.now();
  const before = await getRaw(ctx, whiteboardScenesEntity, id);
  const stmts = [
    ctx.db
      .prepare('INSERT INTO whiteboard_scenes (id, mode, scene, created, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET scene = excluded.scene, updated_at = excluded.updated_at')
      .bind(id, ctx.mode, text, now, now),
  ];
  // Only scrolling or zooming (the view is saved so the board reopens there) does not make it "newest".
  if (opts.thumbnail !== undefined) stmts.push(ctx.db.prepare(`UPDATE whiteboards SET thumbnail = ?${opts.viewOnly ? '' : ', updated_at = ?'} WHERE id = ?`).bind(...(opts.viewOnly ? [opts.thumbnail || null, id] : [opts.thumbnail || null, now, id])));
  else if (!opts.viewOnly) stmts.push(ctx.db.prepare('UPDATE whiteboards SET updated_at = ? WHERE id = ?').bind(now, id));
  await ctx.db.batch(stmts);
  if (opts.undoable) {
    ctx.changes.push({ entity: whiteboardScenesEntity.name, table: whiteboardScenesEntity.table, rowId: id, before, after: { id, mode: ctx.mode, scene: text, created: before?.created ?? now, updated_at: now } });
  }
  return now;
}

async function sceneOf(ctx: Ctx, id: string): Promise<string | null> {
  const r = await ctx.db.prepare('SELECT scene FROM whiteboard_scenes WHERE id = ? AND mode = ?').bind(id, ctx.mode).first<{ scene: string }>();
  return r?.scene ?? null;
}

/** Excalidraw element types Claude may draw with. */
const ELEMENT_TYPES = ['rectangle', 'ellipse', 'diamond', 'arrow', 'line', 'text', 'freedraw', 'frame', 'image', 'embeddable', 'iframe', 'magicframe', 'selection'] as const;
const elementSchema = z.object({ type: z.enum(ELEMENT_TYPES) }).passthrough();

/** What get_whiteboard shows of an element by default: enough to read and redraw it, not Excalidraw's bookkeeping. */
const COMPACT_KEYS = ['id', 'type', 'x', 'y', 'width', 'height', 'angle', 'text', 'label', 'strokeColor', 'backgroundColor', 'fillStyle', 'points', 'containerId', 'groupIds', 'frameId', 'fontSize', 'link', 'fileId'];

function compactElement(e: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of COMPACT_KEYS) if (e[k] !== undefined && e[k] !== null && !(Array.isArray(e[k]) && !(e[k] as unknown[]).length)) out[k] = e[k];
  const bind = (b: unknown) => (b && typeof b === 'object' ? (b as { elementId?: string }).elementId : undefined);
  if (bind(e.startBinding)) out.start = bind(e.startBinding);
  if (bind(e.endBinding)) out.end = bind(e.endBinding);
  if (Array.isArray(e.boundElements) && e.boundElements.length) out.boundElements = (e.boundElements as { id: string; type: string }[]).map((b) => `${b.type}:${b.id}`);
  return out;
}

async function boardList(ctx: Ctx, projectId?: string | null) {
  const cond = ['w.mode = ?'];
  const params: unknown[] = [ctx.mode];
  if (projectId === null) cond.push('w.project_id IS NULL');
  else if (projectId) {
    cond.push('w.project_id = ?');
    params.push(projectId);
  }
  const rows = await ctx.db
    .prepare(
      `SELECT w.id, w.name, w.project_id, p.name AS project, w.show_today, w.updated_at, w.thumbnail IS NOT NULL AS has_preview, length(s.scene) AS drawing_size
       FROM whiteboards w LEFT JOIN projects p ON p.id = w.project_id LEFT JOIN whiteboard_scenes s ON s.id = w.id
       WHERE ${cond.join(' AND ')} ORDER BY w.updated_at DESC LIMIT 500`,
    )
    .bind(...params)
    .all<Record<string, unknown>>();
  return rows.results.map((r) => ({ ...r, show_today: r.show_today === 1, has_preview: r.has_preview === 1, drawing_size: r.drawing_size ?? 0 }));
}

/** Whiteboards as files (the Files tab); the preview image comes from GET /api/whiteboards/:id/thumbnail. */
async function boardFiles(ctx: Ctx, like: string | null): Promise<FileItem[]> {
  const rows = await ctx.db
    .prepare(`SELECT id, name, folder_id, project_id, show_today, created, updated_at, thumbnail IS NOT NULL AS has_preview FROM whiteboards WHERE mode = ?1${like ? ` AND name LIKE ?2 ESCAPE '\\'` : ''} LIMIT 2000`)
    .bind(...(like ? [ctx.mode, like] : [ctx.mode]))
    .all<{ id: string; name: string; folder_id: string | null; project_id: string | null; show_today: number; created: string; updated_at: string; has_preview: number }>();
  return rows.results.map((r) => ({ type: 'whiteboard', id: r.id, name: r.name, folder_id: r.folder_id, project_id: r.project_id, show_today: r.show_today === 1, created: r.created, updated_at: r.updated_at, thumbnail: r.has_preview === 1 }));
}

export const whiteboardsModule: Module = {
  id: 'whiteboards',
  files: [
    {
      type: 'whiteboard',
      group: 'whiteboards',
      label: 'Whiteboard',
      entity: 'whiteboards',
      feature: FLAG,
      list: boardFiles,
      today: { prefix: 'wb-', set: (ctx, id, on) => update(ctx, whiteboardsEntity, id, { show_today: on }) },
    },
  ],
  description: 'Excalidraw whiteboards on projects or on their own, with previews, a Today panel and Claude tools to draw.',
  entities: [whiteboardsEntity, whiteboardScenesEntity],
  features: [{ id: FLAG, label: 'Whiteboards', description: 'Excalidraw whiteboards: a Whiteboards tab, boards on project pages and on Today.', default: true }],
  routes(api) {
    api.get('/whiteboards/:id/scene', async (c) => {
      const ctx = c.get('ctx');
      await requireFeature(ctx, FLAG);
      const board = await get(ctx, whiteboardsEntity, c.req.param('id'));
      const text = await sceneOf(ctx, board.id);
      // The drawing goes out as stored, without parsing it here (it can be large; 10 ms CPU per request).
      const body = `{"id":${JSON.stringify(board.id)},"name":${JSON.stringify(board.name)},"updated_at":${JSON.stringify(board.updated_at)},"scene":${text ?? 'null'}}`;
      return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
    });
    api.put('/whiteboards/:id/scene', async (c) => {
      const ctx = c.get('ctx');
      await requireFeature(ctx, FLAG);
      const length = Number(c.req.header('Content-Length') ?? 0);
      if (length > MAX_SCENE_BYTES * 2 + MAX_THUMBNAIL) {
        throw new ApiError(413, `This drawing is too big to save (${mb(length)}; the limit is ${mb(MAX_SCENE_BYTES)}). Remove some images or drawings and try again.`, 'too_big');
      }
      const board = await get(ctx, whiteboardsEntity, c.req.param('id'));
      const body = await c.req.json<{ scene?: unknown; thumbnail?: string | null; view_only?: boolean }>();
      const text = sceneText(body.scene);
      if (body.thumbnail !== undefined) checkThumbnail(body.thumbnail);
      const updated_at = await writeScene(ctx, board.id, text, { thumbnail: body.thumbnail, viewOnly: body.view_only === true });
      return c.json({ id: board.id, updated_at, size: bytes(text), limit: MAX_SCENE_BYTES });
    });
    // The generic routes, with readable undo labels.
    api.post('/whiteboards', async (c) => {
      const ctx = c.get('ctx');
      ctx.label = 'new whiteboard';
      return c.json(await create(ctx, whiteboardsEntity, await c.req.json()), 201);
    });
    api.patch('/whiteboards/:id', async (c) => {
      const ctx = c.get('ctx');
      const body = await c.req.json<Record<string, unknown>>();
      ctx.label = 'name' in body ? 'rename whiteboard' : 'project_id' in body ? 'move whiteboard' : 'show_today' in body ? (body.show_today ? 'whiteboard on Today' : 'whiteboard off Today') : 'change whiteboard';
      return c.json(await update(ctx, whiteboardsEntity, c.req.param('id'), body));
    });
    api.delete('/whiteboards/:id', async (c) => {
      const ctx = c.get('ctx');
      ctx.label = 'delete whiteboard';
      await remove(ctx, whiteboardsEntity, c.req.param('id'));
      return c.json({ deleted: c.req.param('id') });
    });
    // The preview as an image (the Files tab's grid), so lists need not carry it. The address
    // carries the board's updated_at, so the browser may keep it.
    api.get('/whiteboards/:id/thumbnail', async (c) => {
      const ctx = c.get('ctx');
      await requireFeature(ctx, FLAG);
      const board = await get(ctx, whiteboardsEntity, c.req.param('id'));
      const m = THUMB_RE.exec(String(board.thumbnail ?? ''));
      if (!m) return c.json({ error: 'This whiteboard has no preview', code: 'not_found' }, 404);
      const bin = atob(String(board.thumbnail).slice(String(board.thumbnail).indexOf(',') + 1));
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return new Response(out, { headers: { 'Content-Type': `image/${m[1]}`, 'Cache-Control': 'private, max-age=604800' } });
    });
    // A preview on its own, for a board that has none yet (an imported one opened and closed unchanged).
    // Not undoable, and it does not move the board up the "newest first" list.
    api.put('/whiteboards/:id/thumbnail', async (c) => {
      const ctx = c.get('ctx');
      await requireFeature(ctx, FLAG);
      const board = await get(ctx, whiteboardsEntity, c.req.param('id'));
      const { thumbnail } = await c.req.json<{ thumbnail?: string | null }>();
      checkThumbnail(thumbnail);
      await ctx.db.prepare('UPDATE whiteboards SET thumbnail = ? WHERE id = ?').bind(thumbnail || null, board.id).run();
      return c.json({ id: board.id, thumbnail: thumbnail || null });
    });
  },
  tools: [
    {
      name: 'list_whiteboards',
      description: 'List whiteboards, newest first (without their drawings). Give project_id for one project’s boards, or null for boards of their own.',
      readOnly: true,
      feature: FLAG,
      input: z.object({ project_id: z.string().nullable().optional() }),
      run: (ctx, a) => boardList(ctx, a.project_id),
    },
    {
      name: 'get_whiteboard',
      description:
        'Read a whiteboard’s drawing. By default each element is shortened to what it shows (type, place, size, text, colours, points, arrow ends); full: true gives Excalidraw’s whole elements. Images are listed by file id only.',
      readOnly: true,
      feature: FLAG,
      input: z.object({ id: z.string(), full: z.boolean().optional() }),
      run: async (ctx, a) => {
        const board = await get(ctx, whiteboardsEntity, a.id);
        const text = await sceneOf(ctx, board.id);
        const scene = text ? (JSON.parse(text) as { elements?: Record<string, unknown>[]; files?: Record<string, { mimeType?: string }>; appState?: Record<string, unknown> }) : null;
        const elements = (scene?.elements ?? []).filter((e) => !e.isDeleted);
        const { thumbnail, ...rest } = board;
        return {
          ...rest,
          has_preview: !!thumbnail,
          elements: a.full ? elements : elements.map(compactElement),
          files: Object.entries(scene?.files ?? {}).map(([id, f]) => ({ id, mimeType: f?.mimeType })),
          background: scene?.appState?.viewBackgroundColor ?? null,
        };
      },
    },
    {
      name: 'create_whiteboard',
      description:
        'Make a whiteboard, optionally on a project, optionally with a drawing. elements are Excalidraw elements; simple ones are enough and the app fills in the rest when the board opens: ' +
        '{"type":"rectangle","id":"a","x":0,"y":0,"width":180,"height":80,"label":{"text":"Idea"}}, {"type":"ellipse"|"diamond", ...}, {"type":"text","x":0,"y":120,"text":"Note"}, ' +
        '{"type":"arrow","x":180,"y":40,"width":120,"height":0,"start":{"id":"a"},"end":{"id":"b"}}. Colours: strokeColor, backgroundColor as #rrggbb. Undo removes the board.',
      feature: FLAG,
      input: z.object({
        name: z.string().min(1),
        project_id: z.string().optional(),
        folder_id: z.string().optional().describe('The Files folder to put it in'),
        show_today: z.boolean().optional(),
        elements: z.array(elementSchema).max(5000).optional(),
        background: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).optional(),
      }),
      run: async (ctx, a) => {
        const board = await create(ctx, whiteboardsEntity, { name: a.name, project_id: a.project_id, folder_id: a.folder_id, show_today: a.show_today });
        if (a.elements?.length) {
          const text = sceneText({ elements: a.elements, appState: { viewBackgroundColor: a.background ?? '#ffffff' }, files: {} });
          await writeScene(ctx, board.id, text, { undoable: true });
        }
        return { ...board, elements: a.elements?.length ?? 0 };
      },
    },
  ],
};
