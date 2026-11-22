// Tags (DECISIONS D43): free labels on any file of a profile (a note, list, to-do, whiteboard,
// link, a project's notes, which are the project's), so Files can filter by tag and widgets can
// show "every file with this tag". Two tables: `tags` (a profile's tags; a name is unique in the
// profile whatever its case) and `tag_links` (a tag on a file: the kind of row the file is and
// its id). Which kinds can be tagged comes from the Files plug-in point (FileSource.rowKind), so a
// new kind of file can be tagged without changes here. The Files listing gets each file's tags,
// a `tag` filter and tag names in its search through `fileAddons`. Everything goes through the
// store, so Undo covers it; deleting a file or a tag removes its links in the same step.
//
// Automatic project tags (D53): every file of a project (and the project and its notes) also has
// a tag with the project's name, id `project:<project id>`. It is worked out when read (from the
// file's project_id), never stored, so it follows renames and deletion with no rows to keep; it
// cannot be put on or taken off by hand.

import { z } from 'zod';
import type { Ctx } from '../core/ctx';
import type { Entity, Row } from '../core/entity';
import { bad, notFound } from '../core/errors';
import { requireFeature } from '../core/features';
import { rowKindOf, type FileAddon, type FileItem } from '../core/files';
import { entity, type Module } from '../core/registry';
import { create, get, getRaw, list, remove, update } from '../core/store';
import { fileSources } from './files';

export const FLAG = 'tags';
const MAX_NAME = 40;
/** The shared colour tokens a tag may have (web: COLORS in core/ui.tsx). */
export const TAG_COLOURS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'grey'] as const;
/** In a filter, "files with no tag". */
export const NO_TAG = 'none';
/** The id of a project's automatic tag: this and the project's id. */
export const AUTO_PREFIX = 'project:';
/** The kind of row a project's notes are in tag_links (target id: the project's). */
export const PROJECT_NOTES = 'project-notes';
const isAuto = (v: unknown) => typeof v === 'string' && v.startsWith(AUTO_PREFIX);
const autoTag = (p: { id: string; name: string }): TagRow => ({ id: AUTO_PREFIX + p.id, name: p.name, color: null, auto: true, project_id: p.id });

/** Every project of the profile, by id (for the automatic tags). */
async function projectNames(ctx: Ctx): Promise<Map<string, { id: string; name: string; status: string }>> {
  const r = await ctx.db.prepare('SELECT id, name, status FROM projects WHERE mode = ?').bind(ctx.mode).all<{ id: string; name: string; status: string }>();
  return new Map(r.results.map((p) => [p.id, p]));
}

/** A project's automatic tag from a tag's id (project:<id>) or a project's name (any case). */
async function findAutoTag(ctx: Ctx, given: string): Promise<TagRow | null> {
  const v = String(given ?? '').trim();
  const p = isAuto(v)
    ? await ctx.db.prepare('SELECT id, name FROM projects WHERE mode = ? AND id = ?').bind(ctx.mode, v.slice(AUTO_PREFIX.length)).first<{ id: string; name: string }>()
    : await ctx.db.prepare('SELECT id, name FROM projects WHERE mode = ? AND name = ? COLLATE NOCASE').bind(ctx.mode, v.replace(/^#+/, '')).first<{ id: string; name: string }>();
  return p ? autoTag(p) : null;
}

type TagRow = { id: string; name: string; color: string | null; auto?: true; project_id?: string };
export type TaggedRef = { kind: string; id: string };

// ---------- names ----------

function cleanName(v: unknown): string {
  const n = String(v ?? '')
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, ' ');
  if (!n) throw bad('A tag needs a name');
  if (n.length > MAX_NAME) throw bad(`A tag name can be at most ${MAX_NAME} characters`);
  if (n.includes(',')) throw bad('A tag name cannot have a comma in it');
  if (n.toLowerCase() === NO_TAG) throw bad(`“${NO_TAG}” is kept for files with no tag; choose another name`);
  return n;
}

async function sameName(ctx: Ctx, name: string, except: string | null): Promise<TagRow | null> {
  return ctx.db
    .prepare('SELECT id, name, color FROM tags WHERE mode = ? AND name = ? COLLATE NOCASE AND id != ?')
    .bind(ctx.mode, name, except ?? '')
    .first<TagRow>();
}

// ---------- the tables ----------

export const tagsEntity: Entity = {
  name: 'tags',
  table: 'tags',
  singular: 'tag',
  desc: 'Free labels on files (notes, lists, to-dos, whiteboards, links, projects, a project’s notes). A name is unique in the profile, whatever its case. Use tag_file / untag_file to put them on files. Every file of a project also has an automatic tag (project:<id>, the project’s name) that is not stored here.',
  modeScoped: true,
  sort: 'name COLLATE NOCASE',
  fields: {
    name: { type: 'text', required: true },
    color: { type: 'text', enum: TAG_COLOURS, desc: `One of ${TAG_COLOURS.join(', ')}; empty = no colour` },
  },
  async beforeCreate(ctx, row) {
    row.name = cleanName(row.name);
    if (row.color === '') row.color = null;
    const clash = await sameName(ctx, String(row.name), null);
    if (clash) throw bad(`There is a tag “${clash.name}” already`);
  },
  async beforeUpdate(ctx, before, patch) {
    if ('color' in patch && patch.color === '') patch.color = null;
    if (!('name' in patch)) return;
    patch.name = cleanName(patch.name);
    const clash = await sameName(ctx, String(patch.name), before.id);
    if (clash) throw bad(`There is a tag “${clash.name}” already: merge them instead`);
  },
};

export const tagLinksEntity: Entity = {
  name: 'tag_links',
  table: 'tag_links',
  singular: 'tag on a file',
  desc: 'A tag on a file (managed by the tags module: use tag_file / untag_file).',
  modeScoped: true,
  internal: true,
  filters: ['tag_id', 'kind', 'target_id'],
  fields: {
    tag_id: { type: 'text', required: true, ref: 'tags', cascade: true },
    kind: { type: 'text', required: true, desc: 'The kind of row the file is: lists, whiteboards, resources, projects or project-notes' },
    target_id: { type: 'text', required: true },
  },
};

// ---------- which files can be tagged ----------

/** Kinds of rows that can carry tags: every file source's row kind, and projects themselves. */
const taggableKinds = (): Set<string> => new Set([...fileSources().map(rowKindOf), 'projects']);

/** A file as callers name it, a file type (note, todo, whiteboard, link, project-note ...) or a kind of row (lists, projects ...), as the kind of row it is. */
export function refOf(type: string, id: string): TaggedRef {
  const t = String(type ?? '').trim().toLowerCase();
  const s = fileSources().find((x) => x.type === t);
  const kind = s ? rowKindOf(s) : t === 'project' ? 'projects' : t;
  if (!taggableKinds().has(kind)) throw bad(`Cannot tag "${type}". Types: ${fileSources().map((x) => x.type).join(', ')}, project`);
  if (!id) throw bad('Which file? Give its id');
  return { kind, id };
}

async function checkTarget(ctx: Ctx, r: TaggedRef): Promise<void> {
  // A project's notes are the project's (their id is the project's).
  const e = entity(r.kind === PROJECT_NOTES ? 'projects' : r.kind);
  const row = await getRaw(ctx, e, r.id);
  if (!row || (e.modeScoped && row.mode !== ctx.mode)) throw notFound(e.singular, r.id);
}

// ---------- reading ----------

/** Every tag of the profile, by name, with how many files carry it; then the projects' automatic
 *  tags by name (auto: true, read only, with the project's status; count is not worked out: null). */
export async function listTags(ctx: Ctx) {
  const r = await ctx.db
    .prepare(
      `SELECT t.id, t.name, t.color, t.created, t.updated_at, COUNT(l.id) AS count
       FROM tags t LEFT JOIN tag_links l ON l.tag_id = t.id WHERE t.mode = ? GROUP BY t.id ORDER BY t.name COLLATE NOCASE`,
    )
    .bind(ctx.mode)
    .all<TagRow & { created: string; updated_at: string; count: number | null }>();
  const projects = [...(await projectNames(ctx)).values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  return [...r.results, ...projects.map((p) => ({ ...autoTag(p), status: p.status, count: null }))];
}

/** The project a tagged row belongs to (for its automatic tag). */
async function projectOfTarget(ctx: Ctx, r: TaggedRef): Promise<string | null> {
  if (r.kind === 'projects' || r.kind === PROJECT_NOTES) return r.id;
  const e = entity(r.kind);
  if (!('project_id' in e.fields)) return null;
  const row = await ctx.db.prepare(`SELECT project_id FROM ${e.table} WHERE mode = ? AND id = ?`).bind(ctx.mode, r.id).first<{ project_id: string | null }>();
  return row?.project_id ?? null;
}

/** The tags on one file: its project's automatic tag first, then its own by name. */
export async function tagsOf(ctx: Ctx, r: TaggedRef): Promise<TagRow[]> {
  const res = await ctx.db
    .prepare('SELECT t.id, t.name, t.color FROM tag_links l JOIN tags t ON t.id = l.tag_id WHERE l.mode = ? AND l.kind = ? AND l.target_id = ? ORDER BY t.name COLLATE NOCASE')
    .bind(ctx.mode, r.kind, r.id)
    .all<TagRow>();
  const pid = await projectOfTarget(ctx, r);
  const p = pid ? await ctx.db.prepare('SELECT id, name FROM projects WHERE mode = ? AND id = ?').bind(ctx.mode, pid).first<{ id: string; name: string }>() : null;
  return p ? [autoTag(p), ...res.results] : res.results;
}

/** Every tagged file of the profile: `<kind>:<id>` → its tags (one query). */
async function allTagged(ctx: Ctx): Promise<Map<string, TagRow[]>> {
  const res = await ctx.db
    .prepare('SELECT l.kind, l.target_id, t.id, t.name, t.color FROM tag_links l JOIN tags t ON t.id = l.tag_id WHERE l.mode = ? ORDER BY t.name COLLATE NOCASE')
    .bind(ctx.mode)
    .all<TagRow & { kind: string; target_id: string }>();
  const out = new Map<string, TagRow[]>();
  for (const r of res.results) {
    const k = `${r.kind}:${r.target_id}`;
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push({ id: r.id, name: r.name, color: r.color });
  }
  return out;
}

/** A tag by id or by name (any case). `make`: a name that is not a tag yet becomes one. */
export async function findTag(ctx: Ctx, given: string, make = false): Promise<TagRow> {
  const v = String(given ?? '').trim();
  const byId = await ctx.db.prepare('SELECT id, name, color FROM tags WHERE mode = ? AND id = ?').bind(ctx.mode, v).first<TagRow>();
  if (byId) return byId;
  const name = cleanName(v);
  const byName = await sameName(ctx, name, null);
  if (byName) return byName;
  if (!make) throw bad(`No tag called “${name}”`);
  const t = await create(ctx, tagsEntity, { name });
  return { id: t.id, name: String(t.name), color: null };
}

// ---------- changing ----------

export interface SetTagsInput {
  /** Tags to put on (names or ids; a new name makes a tag). */
  add?: string[];
  /** Tags to take off (names or ids). */
  remove?: string[];
  /** Or the whole set: exactly these tags. */
  tags?: string[];
}

/** Change one file's tags. One undo step. Answers with the file's tags. */
export async function setTags(ctx: Ctx, r: TaggedRef, input: SetTagsInput) {
  await checkTarget(ctx, r);
  // A project's automatic tag comes from the project: it cannot be put on or taken off.
  const auto = [...(input.add ?? []), ...(input.remove ?? [])].find(isAuto);
  if (auto) throw bad('A project’s tag is automatic: every file of the project has it. Move the file to another project (or out of it) to change it');
  input = { ...input, tags: input.tags?.filter((t) => !isAuto(t)) };
  const links = await list(ctx, tagLinksEntity, { where: { kind: r.kind, target_id: r.id }, limit: 500 });
  const has = new Map(links.map((l) => [String(l.tag_id), l]));
  const want = new Set<string>();
  const drop = new Set<string>();
  if (input.tags) {
    for (const g of input.tags) want.add((await findTag(ctx, g, true)).id);
    for (const id of has.keys()) if (!want.has(id)) drop.add(id);
  }
  for (const g of input.add ?? []) want.add((await findTag(ctx, g, true)).id);
  for (const g of input.remove ?? []) {
    const t = await findTag(ctx, g).catch(() => null);
    if (t) (drop.add(t.id), want.delete(t.id));
  }
  for (const id of want) if (!has.has(id)) await create(ctx, tagLinksEntity, { tag_id: id, kind: r.kind, target_id: r.id });
  for (const id of drop) if (has.has(id)) await remove(ctx, tagLinksEntity, has.get(id)!.id);
  return { kind: r.kind, id: r.id, tags: await tagsOf(ctx, r) };
}

/** Put `from`'s files under `into` and delete `from`. One undo step. */
export async function mergeTags(ctx: Ctx, fromId: string, intoId: string) {
  const from = await get(ctx, tagsEntity, fromId);
  const into = await get(ctx, tagsEntity, intoId);
  if (from.id === into.id) throw bad('Choose two different tags to merge');
  const already = new Set((await list(ctx, tagLinksEntity, { where: { tag_id: into.id }, limit: 2000 })).map((l) => `${l.kind}:${l.target_id}`));
  for (const l of await list(ctx, tagLinksEntity, { where: { tag_id: from.id }, limit: 2000 })) {
    if (already.has(`${l.kind}:${l.target_id}`)) await remove(ctx, tagLinksEntity, l.id);
    else await update(ctx, tagLinksEntity, l.id, { tag_id: into.id });
  }
  await remove(ctx, tagsEntity, from.id);
  return { merged: from.id, into: (await listTags(ctx)).find((t) => t.id === into.id) };
}

// ---------- the Files listing ----------

const filesAddon: FileAddon = {
  id: 'tags',
  feature: FLAG,
  async decorate(ctx, files, keyOf) {
    const [tagged, projects] = await Promise.all([allTagged(ctx), projectNames(ctx)]);
    for (const f of files) {
      const own = tagged.get(keyOf(f)) ?? [];
      const p = f.project_id ? projects.get(f.project_id) : undefined;
      f.tags = p ? [autoTag(p), ...own] : own;
    }
  },
  async search(ctx, like) {
    const [res, projects] = await ctx.db.batch<any>([
      ctx.db.prepare(`SELECT l.kind, l.target_id FROM tag_links l JOIN tags t ON t.id = l.tag_id WHERE l.mode = ? AND t.name LIKE ? ESCAPE '\\'`).bind(ctx.mode, like),
      ctx.db.prepare(`SELECT id FROM projects WHERE mode = ? AND name LIKE ? ESCAPE '\\'`).bind(ctx.mode, like),
    ]);
    const keys = new Set((res.results as { kind: string; target_id: string }[]).map((r) => `${r.kind}:${r.target_id}`));
    const ofProject = new Set((projects.results as { id: string }[]).map((r) => r.id));
    if (!keys.size && !ofProject.size) return null;
    return (f, key) => keys.has(key) || (!!f.project_id && ofProject.has(f.project_id));
  },
  filter: {
    param: 'tag',
    async apply(ctx, files: FileItem[], value) {
      const asked = value.split(',').map((v) => v.trim()).filter(Boolean);
      // No tag: none of the owner's own (a project's automatic tag does not count).
      if (asked.some((v) => v.toLowerCase() === NO_TAG)) return files.filter((f) => !f.tags?.some((t) => !t.auto));
      const ids: string[][] = [];
      for (const a of asked) {
        // A tag of the owner's or a project's automatic tag (by id, or by name: either matches).
        const found = [await findTag(ctx, a).catch(() => null), await findAutoTag(ctx, a)].filter((t): t is TagRow => !!t);
        if (!found.length) return [];
        ids.push(found.map((t) => t.id));
      }
      return files.filter((f) => ids.every((any) => f.tags?.some((t) => any.includes(t.id))));
    },
  },
};

// ---------- the module ----------

const setBody = z.object({
  type: z.string().min(1).describe('The file’s type as list_files gives it (note, todo, list, whiteboard, link, project-note) or project'),
  id: z.string().min(1),
  add: z.array(z.string()).max(50).optional(),
  remove: z.array(z.string()).max(50).optional(),
  tags: z.array(z.string()).max(50).optional(),
});
const tagInput = z.object({ name: z.string().min(1), color: z.enum(TAG_COLOURS).nullable().optional() });
const fileArgs = {
  type: z.string().min(1).describe('The file’s type from list_files (note, todo, list, whiteboard, link, project-note), or project'),
  id: z.string().min(1),
  tags: z.array(z.string().min(1)).min(1).max(50).describe('Tag names or ids'),
};

export const tagsModule: Module = {
  id: 'tags',
  description: 'Tags: free labels on any file (notes, lists, to-dos, whiteboards, links, projects), to filter Files by.',
  entities: [tagsEntity, tagLinksEntity],
  features: [
    {
      id: FLAG,
      label: 'Tags',
      description: 'Free tags on any file (note, list, to-do, whiteboard, link, a project’s notes): chips on Files and Add file, a Tags filter in Files, a tag editor on a file’s page and in its ⋯ menu, and Manage tags. Off: tags are hidden (kept, not deleted).',
      default: true,
    },
  ],
  fileAddons: [filesAddon],
  async beforeDelete(ctx, e: Entity, row: Row) {
    if (!taggableKinds().has(e.name)) return;
    // A project's notes go with the project.
    for (const kind of e.name === 'projects' ? [e.name, PROJECT_NOTES] : [e.name]) {
      for (const l of await list(ctx, tagLinksEntity, { where: { kind, target_id: row.id }, limit: 500 })) {
        if (await getRaw(ctx, tagLinksEntity, l.id)) await remove(ctx, tagLinksEntity, l.id);
      }
    }
  },
  routes(api) {
    api.get('/tags', async (c) => {
      const ctx = c.get('ctx');
      await requireFeature(ctx, FLAG);
      return c.json(await listTags(ctx));
    });
    api.post('/tags', async (c) => {
      const ctx = c.get('ctx');
      await requireFeature(ctx, FLAG);
      ctx.label = 'new tag';
      return c.json(await create(ctx, tagsEntity, await c.req.json()), 201);
    });
    api.post('/tags/set', async (c) => {
      const ctx = c.get('ctx');
      await requireFeature(ctx, FLAG);
      const b = setBody.parse(await c.req.json());
      ctx.label = 'change tags';
      return c.json(await setTags(ctx, refOf(b.type, b.id), b));
    });
    api.get('/tags/of/:type/:id', async (c) => {
      const ctx = c.get('ctx');
      await requireFeature(ctx, FLAG);
      const r = refOf(c.req.param('type'), c.req.param('id'));
      await checkTarget(ctx, r);
      return c.json(await tagsOf(ctx, r));
    });
    api.patch('/tags/:id', async (c) => {
      const ctx = c.get('ctx');
      await requireFeature(ctx, FLAG);
      const body = await c.req.json<Record<string, unknown>>();
      ctx.label = 'name' in body ? 'rename tag' : 'tag colour';
      return c.json(await update(ctx, tagsEntity, c.req.param('id'), { name: body.name, color: body.color }));
    });
    api.post('/tags/:id/merge', async (c) => {
      const ctx = c.get('ctx');
      await requireFeature(ctx, FLAG);
      const b = z.object({ into: z.string().min(1) }).parse(await c.req.json());
      ctx.label = 'merge tags';
      return c.json(await mergeTags(ctx, c.req.param('id'), b.into));
    });
    api.delete('/tags/:id', async (c) => {
      const ctx = c.get('ctx');
      await requireFeature(ctx, FLAG);
      ctx.label = 'delete tag';
      return c.json(await remove(ctx, tagsEntity, c.req.param('id')));
    });
  },
  tools: [
    {
      name: 'list_tags',
      description:
        'List the profile’s tags with their colour and how many files carry each, then the projects’ automatic tags (auto: true, id project:<project id>, the project’s name; every file of the project has it; read only). list_files with tags finds the files.',
      readOnly: true,
      feature: FLAG,
      input: z.object({}),
      run: (ctx) => listTags(ctx),
    },
    {
      name: 'create_tag',
      description: 'Make a tag (a name unique in the profile, whatever its case; colour optional). tag_file also makes tags it does not know.',
      feature: FLAG,
      input: tagInput,
      run: (ctx, a) => create(ctx, tagsEntity, a),
    },
    {
      name: 'update_tag',
      description: 'Rename or recolour a tag (color null = none). Every file with it shows the new name.',
      feature: FLAG,
      input: z.object({ id: z.string(), name: z.string().min(1).optional(), color: z.enum(TAG_COLOURS).nullable().optional() }),
      run: (ctx, { id, ...patch }) => update(ctx, tagsEntity, id, patch),
    },
    {
      name: 'delete_tag',
      description: 'Delete a tag; it comes off every file (the files stay). Undo brings it back.',
      feature: FLAG,
      input: z.object({ id: z.string() }),
      run: (ctx, a) => remove(ctx, tagsEntity, a.id),
    },
    {
      name: 'merge_tags',
      description: 'Merge one tag into another: its files get the other tag and it is deleted.',
      feature: FLAG,
      input: z.object({ id: z.string().describe('The tag that goes'), into: z.string().describe('The tag that stays') }),
      run: (ctx, a) => mergeTags(ctx, a.id, a.into),
    },
    {
      name: 'tag_file',
      description:
        'Put tags on a file (type and id as list_files gives them; a project’s notes, type project-note, have their own tags). A name that is not a tag yet becomes one. Any file can have several. A project’s automatic tag cannot be added or removed. Answers with the file’s tags.',
      feature: FLAG,
      input: z.object(fileArgs),
      run: (ctx, a) => setTags(ctx, refOf(a.type, a.id), { add: a.tags }),
    },
    {
      name: 'untag_file',
      description: 'Take tags off a file (type and id as list_files gives them). Answers with the file’s tags.',
      feature: FLAG,
      input: z.object(fileArgs),
      run: (ctx, a) => setTags(ctx, refOf(a.type, a.id), { remove: a.tags }),
    },
  ],
};
