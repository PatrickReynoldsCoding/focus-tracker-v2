// Files (DECISIONS D31): folders, and one place that lists every file-like row of a mode (notes,
// lists, to-do lists, whiteboards, links, a project's notes) with type filters, search and moves.
// Modules say which of their rows are files in `Module.files` (src/core/files.ts).
//
// Every project has its own folder (folders.project_id), made, renamed and removed with the
// project. The folder a file is in decides its project: moving a file into a project's folder (or
// a folder inside it) sets the file's project_id, moving it out clears it, and giving a file a
// project_id (the project page, Claude) puts it in that project's folder. So a project's page and
// its folder always show the same things. All of it goes through the store, so Undo covers it.

import { z } from 'zod';
import type { Ctx } from '../core/ctx';
import type { Entity, Row } from '../core/entity';
import { bad } from '../core/errors';
import { requireFeature } from '../core/features';
import { likeOf, rowKindOf, type FileAddon, type FileItem, type FileSource } from '../core/files';
import { allModules, entity, type Module } from '../core/registry';
import { create, get, getRaw, list, remove, update } from '../core/store';

export const FLAG = 'files-tab';
const MAX_NAME = 120;

// ---------- per-request state ----------

type State = { system: number; deletingProjects: Set<string> };
const states = new WeakMap<Ctx, State>();
const state = (ctx: Ctx): State => {
  let s = states.get(ctx);
  if (!s) states.set(ctx, (s = { system: 0, deletingProjects: new Set() }));
  return s;
};
/** Changes the Files module makes itself (a project's folder, keeping names in step). */
async function asSystem<T>(ctx: Ctx, fn: () => Promise<T>): Promise<T> {
  state(ctx).system++;
  try {
    return await fn();
  } finally {
    state(ctx).system--;
  }
}

// ---------- folders ----------

function cleanName(v: unknown): string {
  const n = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (!n) throw bad('A folder needs a name');
  if (n.length > MAX_NAME) throw bad(`A folder name can be at most ${MAX_NAME} characters`);
  return n;
}

export const foldersEntity: Entity = {
  name: 'folders',
  table: 'folders',
  singular: 'folder',
  desc: 'Folders of the Files tab, nested with parent_id. A project has its own folder (project_id set): it is made, renamed and removed with the project, and renaming it renames the project.',
  modeScoped: true,
  filters: ['parent_id', 'project_id'],
  sort: 'name COLLATE NOCASE',
  fields: {
    name: { type: 'text', required: true },
    parent_id: { type: 'text', ref: 'folders', desc: 'The folder it is in; empty = top level' },
    project_id: { type: 'text', ref: 'projects', cascade: true, desc: 'Set on a project’s own folder (by the app only)' },
  },
  beforeCreate(ctx, row) {
    row.name = cleanName(row.name);
    if (row.project_id && !state(ctx).system) throw bad('A project’s folder is made with the project');
    if (row.parent_id === '') row.parent_id = null;
  },
  async beforeUpdate(ctx, before, patch) {
    if ('name' in patch) patch.name = cleanName(patch.name);
    if ('project_id' in patch && patch.project_id !== before.project_id && !state(ctx).system) throw bad('A folder cannot change project');
    if ('parent_id' in patch) {
      if (patch.parent_id === '') patch.parent_id = null;
      if (patch.parent_id) {
        const all = await allFolders(ctx);
        for (let at: string | null = String(patch.parent_id), guard = 0; at && guard < 500; at = all.get(at)?.parent_id ?? null, guard++) {
          if (at === before.id) throw bad('A folder cannot go inside itself');
        }
      }
    }
  },
  async onDelete(ctx, row) {
    if (row.project_id && !state(ctx).deletingProjects.has(String(row.project_id)) && (await getRaw(ctx, entity('projects'), String(row.project_id)))) {
      throw bad(`“${row.name}” is the folder of a project: it goes when the project is deleted`);
    }
    // What is inside moves up to the folder's parent (contents=delete removes it first, see deleteFolder).
    const to = (row.parent_id as string | null) ?? null;
    for (const f of await list(ctx, foldersEntity, { where: { parent_id: row.id }, limit: 2000 })) await update(ctx, foldersEntity, f.id, { parent_id: to });
    for (const e of movableEntities()) {
      for (const r of await list(ctx, e, { where: { folder_id: row.id }, limit: 2000 })) await update(ctx, e, r.id, { folder_id: to });
    }
  },
};

type FolderRow = { id: string; name: string; parent_id: string | null; project_id: string | null; created: string; updated_at: string };

/** Every folder of the mode, by id (one small query). */
async function allFolders(ctx: Ctx): Promise<Map<string, FolderRow>> {
  const r = await ctx.db.prepare('SELECT id, name, parent_id, project_id, created, updated_at FROM folders WHERE mode = ?').bind(ctx.mode).all<FolderRow>();
  return new Map(r.results.map((f) => [f.id, f]));
}

/** The project a folder belongs to: its own, or the nearest project folder it is inside. */
function projectIn(all: Map<string, FolderRow>, id: string | null): string | null {
  for (let at = id, guard = 0; at && guard < 500; guard++) {
    const f = all.get(at);
    if (!f) return null;
    if (f.project_id) return f.project_id;
    at = f.parent_id;
  }
  return null;
}

/** A folder and every folder inside it. */
function subtree(all: Map<string, FolderRow>, id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of all.values()) if (f.parent_id && out.has(f.parent_id) && !out.has(f.id)) (out.add(f.id), (grew = true));
  }
  return out;
}

/** The folder of a project, made if it has none. */
export async function projectFolder(ctx: Ctx, projectId: string): Promise<Row> {
  const found = await list(ctx, foldersEntity, { where: { project_id: projectId }, limit: 1 });
  if (found[0]) return found[0];
  const p = await get(ctx, entity('projects'), projectId);
  return asSystem(ctx, () => create(ctx, foldersEntity, { name: String(p.name), project_id: projectId }));
}

// ---------- file sources ----------

export const fileSources = (): FileSource[] => allModules().flatMap((m) => m.files ?? []);
const movableEntities = (): Entity[] => [...new Set(fileSources().flatMap((s) => (s.entity ? [s.entity] : [])))].map((n) => entity(n));
const isFileEntity = (e: Entity) => 'folder_id' in e.fields && fileSources().some((s) => s.entity === e.name);

async function activeSources(ctx: Ctx, types?: string[]): Promise<FileSource[]> {
  const out: FileSource[] = [];
  for (const s of fileSources()) {
    if (types?.length && !types.includes(s.type) && !types.includes(s.group)) continue;
    if (s.feature && !(await ctx.feature(s.feature))) continue;
    out.push(s);
  }
  return out;
}

async function activeAddons(ctx: Ctx): Promise<FileAddon[]> {
  const out: FileAddon[] = [];
  for (const a of allModules().flatMap((m) => m.fileAddons ?? [])) if (!a.feature || (await ctx.feature(a.feature))) out.push(a);
  return out;
}

// ---------- listing ----------

export interface ListFilesOptions {
  /** A folder id; null or absent = the top level. */
  folder?: string | null;
  /** Or a project: its folder. */
  project?: string | null;
  /** File types or groups ('note', 'notes', 'whiteboards' ...). */
  types?: string[];
  q?: string | null;
  sort?: 'name' | 'changed';
  limit?: number;
  /** Values for the addons' filters (FileAddon.filter.param), such as { tag: 'work,urgent' }. */
  extra?: Record<string, string | undefined>;
}

export async function listFiles(ctx: Ctx, o: ListFilesOptions = {}) {
  const [all, projects] = await Promise.all([
    allFolders(ctx),
    ctx.db.prepare('SELECT id, name, status FROM projects WHERE mode = ?').bind(ctx.mode).all<{ id: string; name: string; status: string }>(),
  ]);
  const statusOf = new Map(projects.results.map((p) => [p.id, p.status]));
  const nameOf = new Map(projects.results.map((p) => [p.id, p.name]));
  const folderOfProject = new Map<string, string>();
  for (const f of all.values()) if (f.project_id) folderOfProject.set(f.project_id, f.id);

  let current: string | null = o.folder || null;
  if (o.project) {
    current = folderOfProject.get(o.project) ?? (await projectFolder(ctx, o.project)).id;
    if (!all.has(current)) return listFiles(ctx, { ...o, project: null, folder: current });
  }
  if (current && !all.has(current)) throw bad(`No folder with id ${current}`);

  const q = (o.q ?? '').trim();
  const types = (o.types ?? []).filter(Boolean);
  const addons = await activeAddons(ctx);
  const filters = addons.flatMap((a) => (a.filter && o.extra?.[a.filter.param]?.trim() ? [{ f: a.filter, value: o.extra[a.filter.param]!.trim() }] : []));
  // A search, a type filter or an addon's filter (a tag) looks in the folder and every folder inside it (at the top: everywhere).
  const deep = !!q || types.length > 0 || filters.length > 0;
  const scope = current ? subtree(all, current) : null;
  const inScope = (folder: string | null) => (deep ? !scope || (!!folder && scope.has(folder)) : folder === current);

  const sources = await activeSources(ctx, types);
  const like = q ? likeOf(q) : null;
  const kindOfType = new Map(fileSources().map((s) => [s.type, rowKindOf(s)]));
  const keyOf = (f: FileItem) => `${kindOfType.get(f.type) ?? f.type}:${f.id}`;
  let found = (await Promise.all(sources.map((s) => s.list(ctx, like)))).flat();
  if (like) {
    // Files that match some other way (a tag's name) are found too.
    const keys = new Set<string>();
    for (const a of addons) if (a.search) for (const k of await a.search(ctx, like)) keys.add(k);
    if (keys.size) {
      const seen = new Set(found.map((f) => `${f.type}:${f.id}`));
      const more = (await Promise.all(sources.map((s) => s.list(ctx, null)))).flat().filter((f) => keys.has(keyOf(f)) && !seen.has(`${f.type}:${f.id}`));
      found = [...found, ...more];
    }
  }
  for (const a of addons) if (a.decorate) await a.decorate(ctx, found, keyOf);
  for (const { f, value } of filters) found = await f.apply(ctx, found, value);
  const here = current ? all.get(current)! : null;
  const files: (FileItem & { location?: string | null; project_name: string | null })[] = [];
  for (const f of found) {
    const folder = f.folder_id ?? (f.project_id ? (folderOfProject.get(f.project_id) ?? null) : null);
    if (!inScope(folder)) continue;
    // A project's empty notes show only in the project's own folder (unless someone tagged them).
    if (f.quiet && !f.tags?.length && (deep || !here || here.project_id !== f.project_id)) continue;
    files.push({ ...f, folder_id: folder, project_name: f.project_id ? (nameOf.get(f.project_id) ?? null) : null });
  }

  const pathOf = (id: string | null): FolderRow[] => {
    const out: FolderRow[] = [];
    for (let at = id, guard = 0; at && guard < 500; guard++) {
      const f = all.get(at);
      if (!f) break;
      out.unshift(f);
      at = f.parent_id;
    }
    return out;
  };
  const nameMemo = new Map<string, string>();
  const locationOf = (id: string | null): string | null => {
    if (!id) return null;
    if (!nameMemo.has(id)) nameMemo.set(id, pathOf(id).map((f) => f.name).join(' › '));
    return nameMemo.get(id)!;
  };
  if (deep) for (const f of files) f.location = locationOf(f.folder_id);

  const qLower = q.toLowerCase();
  const folders = [...all.values()]
    .filter((f) => (deep ? !types.length && !filters.length && !!q && f.id !== current && inScope(f.parent_id) && f.name.toLowerCase().includes(qLower) : f.parent_id === current || (!current && f.parent_id && !all.has(f.parent_id))))
    .map((f) => ({ ...f, status: f.project_id ? (statusOf.get(f.project_id) ?? null) : null, ...(deep ? { location: locationOf(f.parent_id) } : {}) }));

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  const byChanged = (a: { updated_at: string }, b: { updated_at: string }) => b.updated_at.localeCompare(a.updated_at);
  const sort = o.sort === 'changed' ? byChanged : byName;
  files.sort(sort);
  folders.sort(sort);
  const limit = Math.min(Math.max(o.limit ?? 500, 1), 2000);
  return {
    folder: here ? { ...here, status: here.project_id ? (statusOf.get(here.project_id) ?? null) : null } : null,
    path: pathOf(current).map((f) => ({ id: f.id, name: f.name, project_id: f.project_id })),
    folders,
    files: files.slice(0, limit),
    more: files.length > limit,
  };
}

// ---------- moving and deleting ----------

export type FileRef = { type: string; id: string };

async function checkFolder(ctx: Ctx, folder: string | null): Promise<void> {
  if (folder) await get(ctx, foldersEntity, folder);
}

/** Move files (and folders, type 'folder') into a folder (null = top level). One undo step. */
export async function moveFiles(ctx: Ctx, items: FileRef[], folder: string | null) {
  await checkFolder(ctx, folder);
  const moved: FileRef[] = [];
  for (const it of items) {
    if (it.type === 'folder') {
      if (it.id === folder) throw bad('A folder cannot go inside itself');
      await update(ctx, foldersEntity, it.id, { parent_id: folder });
    } else {
      const s = fileSources().find((x) => x.type === it.type);
      if (!s) throw bad(`Unknown file type "${it.type}". Types: ${fileSources().map((x) => x.type).join(', ')}, folder`);
      if (!s.entity) throw bad(`A ${s.label.toLowerCase()} stays in its project’s folder`);
      await update(ctx, entity(s.entity), it.id, { folder_id: folder });
    }
    moved.push(it);
  }
  return { moved, folder_id: folder };
}

/** Delete a folder. contents 'move' (default): what is inside moves up to its parent. 'delete':
 *  the files and folders inside are deleted too (project folders inside move up). One undo step. */
export async function deleteFolder(ctx: Ctx, id: string, contents: 'move' | 'delete' = 'move') {
  const folder = await get(ctx, foldersEntity, id);
  if (folder.project_id) throw bad(`“${folder.name}” is the folder of a project: it goes when the project is deleted`);
  let deleted = 0;
  if (contents === 'delete') {
    const all = await allFolders(ctx);
    const empty = async (fid: string) => {
      for (const e of movableEntities()) {
        for (const r of await list(ctx, e, { where: { folder_id: fid }, limit: 2000 })) {
          if (await getRaw(ctx, e, r.id)) (await remove(ctx, e, r.id), deleted++);
        }
      }
      for (const sub of [...all.values()].filter((f) => f.parent_id === fid)) {
        if (sub.project_id) await update(ctx, foldersEntity, sub.id, { parent_id: folder.parent_id ?? null });
        else {
          await empty(sub.id);
          await remove(ctx, foldersEntity, sub.id);
          deleted++;
        }
      }
    };
    await empty(id);
  }
  await remove(ctx, foldersEntity, id);
  return { deleted: id, contents, items_deleted: deleted };
}

/** What a folder holds, all the way down (for "delete this folder?"). */
export async function folderCount(ctx: Ctx, id: string) {
  const all = await allFolders(ctx);
  if (!all.has(id)) await get(ctx, foldersEntity, id);
  const ids = [...subtree(all, id)];
  const folders = ids.length - 1;
  const marks = ids.map(() => '?').join(',');
  let files = 0;
  for (const e of movableEntities()) {
    const r = await ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${e.table} WHERE mode = ? AND folder_id IN (${marks})`).bind(ctx.mode, ...ids).first<{ n: number }>();
    files += r?.n ?? 0;
  }
  return { folders, files, projects: ids.filter((x) => all.get(x)?.project_id && x !== id).length };
}

// ---------- keeping folder and project in step ----------

/** After a folder moved, the files inside it (all the way down) take the project of their new place. */
async function resync(ctx: Ctx, folderId: string) {
  const all = await allFolders(ctx);
  const ids = [...subtree(all, folderId)];
  const marks = ids.map(() => '?').join(',');
  await asSystem(ctx, async () => {
    for (const e of movableEntities()) {
      if (!('project_id' in e.fields)) continue;
      const rows = await list(ctx, e, { sql: `folder_id IN (${marks})`, params: ids, limit: 2000 });
      for (const r of rows) {
        const want = projectIn(all, String(r.folder_id));
        if ((r.project_id ?? null) !== want) await update(ctx, e, r.id, { project_id: want });
      }
    }
  });
}

async function beforeWrite(ctx: Ctx, e: Entity, data: Record<string, unknown>, before: Row | null) {
  if (!isFileEntity(e)) return;
  if ('folder_id' in data && data.folder_id === '') data.folder_id = null;
  if (state(ctx).system) return;
  const hasProject = 'project_id' in e.fields;
  if ('folder_id' in data && (!before || data.folder_id !== (before.folder_id ?? null))) {
    // Filed somewhere: the folder decides the project.
    if (!hasProject) return;
    const folder = (data.folder_id as string | null) ?? null;
    data.project_id = folder ? projectIn(await allFolders(ctx), folder) : null;
    return;
  }
  if (!hasProject || !('project_id' in data)) return;
  const next = (data.project_id as string | null) || null;
  const prev = (before?.project_id as string | null) ?? null;
  if (before && next === prev) return;
  const at = (before?.folder_id as string | null) ?? null;
  if (next) {
    // Given a project: into its folder, unless it is already somewhere inside that folder.
    if (at && projectIn(await allFolders(ctx), at) === next) return;
    data.folder_id = (await projectFolder(ctx, next)).id;
  } else if (prev && !state(ctx).deletingProjects.has(prev) && at && projectIn(await allFolders(ctx), at) === prev) {
    // Taken off its project: out of the project's folder, to the top level.
    data.folder_id = null;
  }
}

async function afterWrite(ctx: Ctx, e: Entity, row: Row, before: Row | null) {
  const s = state(ctx);
  if (e.name === 'projects') {
    if (!before) await projectFolder(ctx, row.id);
    else if (row.name !== before.name && !s.system) {
      const f = (await list(ctx, foldersEntity, { where: { project_id: row.id }, limit: 1 }))[0];
      if (f && f.name !== row.name) await asSystem(ctx, () => update(ctx, foldersEntity, f.id, { name: row.name }));
    }
    return;
  }
  if (e.name !== 'folders' || !before) return;
  if (row.project_id && row.name !== before.name && !s.system) {
    // Renaming a project's folder renames the project.
    await asSystem(ctx, () => update(ctx, entity('projects'), String(row.project_id), { name: row.name }));
  }
  if ((row.parent_id ?? null) !== (before.parent_id ?? null)) await resync(ctx, row.id);
}

// ---------- the module ----------

const listQuery = z.object({
  folder: z.string().optional(),
  project: z.string().optional(),
  type: z.string().optional(),
  q: z.string().optional(),
  sort: z.enum(['name', 'changed']).optional(),
  limit: z.coerce.number().int().optional(),
  tag: z.string().optional(),
});
const fileRef = z.object({ type: z.string().min(1).describe('note, todo, list, whiteboard, link, or folder'), id: z.string().min(1) });
const moveBody = z.object({ items: z.array(fileRef).min(1).max(200), folder_id: z.string().nullable() });

export const filesModule: Module = {
  id: 'files',
  description: 'Files: every note, list, whiteboard and link of a mode in one place, in folders; each project has its own folder.',
  entities: [foldersEntity],
  features: [
    {
      id: FLAG,
      label: 'Files tab',
      description: 'One Files tab with folders, search and type filters takes the place of the Notes and Whiteboards tabs. Off: the old Notes and Whiteboards tabs.',
      default: true,
    },
  ],
  beforeWrite,
  afterWrite,
  async beforeDelete(ctx, e, row) {
    if (e.name === 'projects') state(ctx).deletingProjects.add(row.id);
  },
  routes(api) {
    api.get('/files', async (c) => {
      const ctx = c.get('ctx');
      await requireFeature(ctx, FLAG);
      const o = listQuery.parse(c.req.query());
      return c.json(await listFiles(ctx, { folder: o.folder === 'root' ? null : o.folder, project: o.project, types: o.type?.split(','), q: o.q, sort: o.sort, limit: o.limit, extra: { tag: o.tag } }));
    });
    api.post('/files/move', async (c) => {
      const ctx = c.get('ctx');
      await requireFeature(ctx, FLAG);
      const b = moveBody.parse(await c.req.json());
      ctx.label = b.items.length === 1 ? 'move' : `move ${b.items.length} items`;
      return c.json(await moveFiles(ctx, b.items, b.folder_id));
    });
    api.get('/folders/:id/count', async (c) => c.json(await folderCount(c.get('ctx'), c.req.param('id'))));
    api.post('/folders', async (c) => {
      const ctx = c.get('ctx');
      ctx.label = 'new folder';
      return c.json(await create(ctx, foldersEntity, await c.req.json()), 201);
    });
    api.patch('/folders/:id', async (c) => {
      const ctx = c.get('ctx');
      const body = await c.req.json<Record<string, unknown>>();
      ctx.label = 'name' in body ? 'rename folder' : 'move folder';
      return c.json(await update(ctx, foldersEntity, c.req.param('id'), body));
    });
    api.delete('/folders/:id', async (c) => {
      const ctx = c.get('ctx');
      ctx.label = 'delete folder';
      const contents = c.req.query('contents') === 'delete' ? 'delete' : 'move';
      return c.json(await deleteFolder(ctx, c.req.param('id'), contents));
    });
  },
  tools: [
    {
      name: 'list_files',
      description:
        'List the Files tab: folders and files (notes, to-do lists, lists, whiteboards, links, project notes; each with project_id and project_name when it belongs to a project, and its tags) in a folder (folder_id; none = top level) or a project’s folder (project_id). With query, type or tags it searches that folder and everything inside it (names, note text, link addresses, tag names). tags: files with all of these tags (names or ids); untagged: files with no tag.',
      readOnly: true,
      feature: FLAG,
      input: z.object({
        folder_id: z.string().optional(),
        project_id: z.string().optional(),
        type: z.string().optional().describe('A type (note, todo, list, whiteboard, link, project-note) or group (notes, lists, whiteboards, links); several with commas'),
        query: z.string().optional(),
        tags: z.array(z.string()).optional().describe('Only files with all of these tags (names or ids)'),
        untagged: z.boolean().optional().describe('Only files with no tag'),
        sort: z.enum(['name', 'changed']).optional(),
        limit: z.number().int().max(2000).optional(),
      }),
      run: (ctx, a) =>
        listFiles(ctx, {
          folder: a.folder_id,
          project: a.project_id,
          types: a.type?.split(','),
          q: a.query,
          sort: a.sort,
          limit: a.limit,
          extra: { tag: a.untagged ? 'none' : a.tags?.length ? a.tags.join(',') : undefined },
        }),
    },
    {
      name: 'create_folder',
      description: 'Make a folder in the Files tab, at the top level or inside parent_id.',
      feature: FLAG,
      input: z.object({ name: z.string().min(1), parent_id: z.string().optional() }),
      run: (ctx, a) => create(ctx, foldersEntity, a),
    },
    {
      name: 'rename_folder',
      description: 'Rename a folder. Renaming a project’s folder renames the project.',
      feature: FLAG,
      input: z.object({ id: z.string(), name: z.string().min(1) }),
      run: (ctx, a) => update(ctx, foldersEntity, a.id, { name: a.name }),
    },
    {
      name: 'move_folder',
      description: 'Move a folder into another folder (parent_id), or to the top level (null). Files inside take the project of their new place.',
      feature: FLAG,
      input: z.object({ id: z.string(), parent_id: z.string().nullable() }),
      run: (ctx, a) => moveFiles(ctx, [{ type: 'folder', id: a.id }], a.parent_id),
    },
    {
      name: 'delete_folder',
      description:
        'Delete a folder (not a project’s folder). contents "move" (default) moves what is inside up to its parent; "delete" deletes the files and folders inside too. Undo brings everything back.',
      feature: FLAG,
      input: z.object({ id: z.string(), contents: z.enum(['move', 'delete']).default('move') }),
      run: (ctx, a) => deleteFolder(ctx, a.id, a.contents),
    },
    {
      name: 'move_files',
      description:
        'Move files into a folder (folder_id; null = top level). items are {type, id} as list_files gives them (type folder moves a folder). Moving into a project’s folder makes the file that project’s; a project’s own notes cannot move.',
      feature: FLAG,
      input: moveBody,
      run: (ctx, a) => moveFiles(ctx, a.items, a.folder_id),
    },
  ],
};
