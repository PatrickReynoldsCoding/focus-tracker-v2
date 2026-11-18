// Issue links, Jira style: a typed relationship between any two items (projects, cards,
// to-dos, backlog items, lists). Each type reads one way from each end ("blocks" /
// "is blocked by"). Rules: no self-links, no duplicates, no loops of blocks or of
// parents. An item blocked by an unfinished item is "Blocked by …" and a blocked project
// is left out of Today's suggestions. Deleting an item deletes its links in the same
// undo step (Module.beforeDelete), so undo brings them back.

import { z } from 'zod';
import type { Ctx } from '../core/ctx';
import type { Entity } from '../core/entity';
import { ApiError, bad, notFound } from '../core/errors';
import { requireFeature } from '../core/features';
import type { Module } from '../core/registry';
import { create, getRaw, remove } from '../core/store';

const FLAG = 'issue-links';
const CUSTOM_FLAG = 'custom-link-types';

// ---------- link types: one line each ----------

export interface LinkType {
  id: string;
  /** How the link reads from its first item: "A blocks B". */
  outward: string;
  /** How it reads from its second item: "B is blocked by A". The same phrase means the type has no direction. */
  inward: string;
  /** The second item waits for the first: it is "Blocked by …" while the first is unfinished. */
  blocking?: boolean;
  /** Links of this type may not form a loop. */
  acyclic?: boolean;
  /** An item has at most one link of this type pointing at it (one parent). */
  oneParent?: boolean;
  /** Added by the owner in Settings. */
  custom?: boolean;
}

export const LINK_TYPES: LinkType[] = [
  { id: 'blocks', outward: 'blocks', inward: 'is blocked by', blocking: true, acyclic: true },
  { id: 'relates', outward: 'relates to', inward: 'relates to' },
  { id: 'duplicates', outward: 'duplicates', inward: 'is duplicated by' },
  { id: 'clones', outward: 'clones', inward: 'is cloned by' },
  { id: 'causes', outward: 'causes', inward: 'is caused by' },
  { id: 'parent', outward: 'is parent of', inward: 'is child of', acyclic: true, oneParent: true },
];

const TYPES_SETTING = 'links.types';

async function customTypes(ctx: Ctx): Promise<LinkType[]> {
  const raw = await ctx.jsonSetting<{ id: string; outward: string; inward: string }[]>(TYPES_SETTING, [], '');
  return Array.isArray(raw) ? raw.map((t) => ({ id: t.id, outward: t.outward, inward: t.inward, custom: true })) : [];
}

/** Built-in types, then the owner's own (kept even while custom-link-types is off, so old links still read well). */
export async function linkTypes(ctx: Ctx): Promise<LinkType[]> {
  return [...LINK_TYPES, ...(await customTypes(ctx))];
}

/** A type by id or phrase. An inward phrase ("is blocked by") means the ends are given the other way round. */
export function resolveType(types: LinkType[], given: string): { type: LinkType; reversed: boolean } {
  const q = given.trim().toLowerCase();
  for (const t of types) if (t.id === q || t.outward.toLowerCase() === q) return { type: t, reversed: false };
  for (const t of types) if (t.inward.toLowerCase() === q) return { type: t, reversed: t.inward !== t.outward };
  throw bad(`Unknown link type "${given}". Types: ${types.map((t) => (t.inward === t.outward ? t.outward : `${t.outward} / ${t.inward}`)).join(', ')}`);
}

// ---------- kinds of items that can be linked ----------

export interface Item {
  kind: string;
  id: string;
  title: string;
  /** open or done; null for lists, which have no status. */
  status: 'open' | 'done' | null;
  /** Where it lives: the card's project or list, the to-do's list, the project's category. */
  context: string | null;
  project_id: string | null;
  list_id: string | null;
  /** A list's kind (list, todo, note). */
  sub: string | null;
}

/**
 * Each linkable kind: a label and a query giving id, title, status, context, project_id,
 * list_id, sub and updated_at for every row of the mode (the first parameter).
 * A card is done when it sits in a column called "Done".
 */
export const LINKABLE: Record<string, { label: string; select: string }> = {
  projects: {
    label: 'project',
    select: `SELECT p.id, p.name AS title, CASE WHEN p.status IN ('done', 'dropped') THEN 'done' ELSE 'open' END AS status,
      c.label AS context, NULL AS project_id, NULL AS list_id, NULL AS sub, p.updated_at
      FROM projects p LEFT JOIN categories c ON c.id = p.category_id WHERE p.mode = ?`,
  },
  tasks: {
    label: 'card',
    select: `SELECT t.id, t.title, CASE WHEN lower(trim(col.name)) = 'done' THEN 'done' ELSE 'open' END AS status,
      COALESCE(p.name, l.name) AS context, t.project_id, t.list_id, NULL AS sub, t.updated_at
      FROM tasks t LEFT JOIN columns col ON col.id = t.column_id LEFT JOIN projects p ON p.id = t.project_id
      LEFT JOIN lists l ON l.id = t.list_id WHERE t.mode = ?`,
  },
  todos: {
    label: 'to-do',
    select: `SELECT t.id, t.title, CASE WHEN t.done IS NOT NULL THEN 'done' ELSE 'open' END AS status,
      l.name AS context, t.project_id, t.list_id, NULL AS sub, t.updated_at
      FROM todos t LEFT JOIN lists l ON l.id = t.list_id WHERE t.mode = ?`,
  },
  backlog: {
    label: 'backlog item',
    select: `SELECT b.id, b.title, 'open' AS status, 'Backlog' AS context, NULL AS project_id, NULL AS list_id, NULL AS sub, b.updated_at
      FROM backlog b WHERE b.mode = ?`,
  },
  lists: {
    label: 'list',
    select: `SELECT l.id, l.name AS title, NULL AS status, p.name AS context, l.project_id, NULL AS list_id, l.kind AS sub, l.updated_at
      FROM lists l LEFT JOIN projects p ON p.id = l.project_id WHERE l.mode = ?`,
  },
};

const ALIASES: Record<string, string> = {
  project: 'projects',
  card: 'tasks',
  cards: 'tasks',
  task: 'tasks',
  todo: 'todos',
  'to-do': 'todos',
  'backlog item': 'backlog',
  list: 'lists',
  note: 'lists',
  notes: 'lists',
};

export function kindOf(k: unknown): string {
  const s = String(k ?? '').trim().toLowerCase();
  const name = LINKABLE[s] ? s : ALIASES[s];
  if (!name) throw bad(`Cannot link "${s}". Kinds: project, card, todo, backlog, list`);
  return name;
}

type Ref = { kind: string; id: string };
const key = (r: Ref) => `${r.kind}:${r.id}`;

/** Items by "kind:id", in this mode. Missing ones are left out. */
async function fetchItems(ctx: Ctx, refs: Ref[]): Promise<Map<string, Item>> {
  const out = new Map<string, Item>();
  const byKind = new Map<string, Set<string>>();
  for (const r of refs) if (LINKABLE[r.kind]) (byKind.get(r.kind) ?? byKind.set(r.kind, new Set()).get(r.kind)!).add(r.id);
  await Promise.all(
    [...byKind].map(async ([kind, set]) => {
      const ids = [...set];
      for (let i = 0; i < ids.length; i += 90) {
        const part = ids.slice(i, i + 90);
        const res = await ctx.db
          .prepare(`SELECT * FROM (${LINKABLE[kind].select}) WHERE id IN (${part.map(() => '?').join(',')})`)
          .bind(ctx.mode, ...part)
          .all<Omit<Item, 'kind'> & { updated_at?: string }>();
        for (const { updated_at: _u, ...r } of res.results) out.set(key({ kind, id: r.id }), { kind, ...r });
      }
    }),
  );
  return out;
}

// ---------- the table ----------

export const linksEntity: Entity = {
  name: 'links',
  table: 'links',
  singular: 'link',
  desc: 'A typed link between two items (projects, cards, to-dos, backlog items, lists), read as "from <type> to": a card blocks a project. Use link_items rather than create_item.',
  modeScoped: true,
  filters: ['from_kind', 'from_id', 'to_kind', 'to_id', 'type'],
  fields: {
    from_kind: { type: 'text', default: 'projects', desc: 'Kind of the first item: projects, tasks (cards), todos, backlog or lists' },
    from_id: { type: 'text', required: true },
    type: { type: 'text', default: 'relates', desc: 'blocks, relates, duplicates, clones, causes, parent, or a custom type (list_link_types)' },
    to_kind: { type: 'text', default: 'projects', desc: 'Kind of the second item' },
    to_id: { type: 'text', required: true },
    note: { type: 'text' },
  },
  async beforeCreate(ctx, row) {
    const types = await linkTypes(ctx);
    const { type, reversed } = resolveType(types, String(row.type || 'relates'));
    let from: Ref = { kind: kindOf(row.from_kind || 'projects'), id: String(row.from_id ?? '') };
    let to: Ref = { kind: kindOf(row.to_kind || 'projects'), id: String(row.to_id ?? '') };
    if (reversed) [from, to] = [to, from];
    if (!from.id || !to.id) throw bad('A link needs both items');
    if (key(from) === key(to)) throw bad('An item cannot link to itself');
    const items = await fetchItems(ctx, [from, to]);
    const a = items.get(key(from));
    const b = items.get(key(to));
    if (!a) throw bad(`No ${LINKABLE[from.kind].label} with id ${from.id}`);
    if (!b) throw bad(`No ${LINKABLE[to.kind].label} with id ${to.id}`);

    const same = (
      await ctx.db
        .prepare(
          `SELECT from_kind, from_id FROM links WHERE mode = ? AND type = ? AND
           ((from_kind = ? AND from_id = ? AND to_kind = ? AND to_id = ?) OR (from_kind = ? AND from_id = ? AND to_kind = ? AND to_id = ?))`,
        )
        .bind(ctx.mode, type.id, from.kind, from.id, to.kind, to.id, to.kind, to.id, from.kind, from.id)
        .all<{ from_kind: string; from_id: string }>()
    ).results;
    const forward = same.some((r) => r.from_kind === from.kind && r.from_id === from.id);
    const backward = same.length > (forward ? 1 : 0);
    if (forward || (backward && type.inward === type.outward)) throw bad(`“${a.title}” already ${type.outward} “${b.title}”`);
    if (type.acyclic && (await reaches(ctx, type.id, key(to), key(from))))
      throw bad(`That would make a loop: “${b.title}” already ${type.outward} “${a.title}”, directly or through other items`);
    if (backward) throw bad(`“${b.title}” already ${type.outward} “${a.title}”`);
    if (type.oneParent) {
      const p = await ctx.db
        .prepare('SELECT from_kind, from_id FROM links WHERE mode = ? AND type = ? AND to_kind = ? AND to_id = ? LIMIT 1')
        .bind(ctx.mode, type.id, to.kind, to.id)
        .first<{ from_kind: string; from_id: string }>();
      if (p) {
        const parent = (await fetchItems(ctx, [{ kind: p.from_kind, id: p.from_id }])).values().next().value;
        throw bad(`“${b.title}” already ${type.inward} “${parent?.title ?? p.from_id}”`);
      }
    }
    Object.assign(row, { from_kind: from.kind, from_id: from.id, to_kind: to.kind, to_id: to.id, type: type.id });
    if (typeof row.note === 'string') row.note = row.note.trim() || null;
  },
  beforeUpdate(_ctx, before, patch) {
    for (const k of ['from_kind', 'from_id', 'to_kind', 'to_id', 'type'])
      if (k in patch && patch[k] !== before[k]) throw bad('Only a link’s note can change. Remove the link and link again.');
  },
};

/** Whether `start` reaches `target` following links of one type (from → to). */
async function reaches(ctx: Ctx, typeId: string, start: string, target: string): Promise<boolean> {
  const edges = (
    await ctx.db
      .prepare("SELECT from_kind || ':' || from_id AS f, to_kind || ':' || to_id AS t FROM links WHERE mode = ? AND type = ?")
      .bind(ctx.mode, typeId)
      .all<{ f: string; t: string }>()
  ).results;
  const next = new Map<string, string[]>();
  for (const e of edges) (next.get(e.f) ?? next.set(e.f, []).get(e.f)!).push(e.t);
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const n = queue.shift()!;
    if (n === target) return true;
    for (const m of next.get(n) ?? []) if (!seen.has(m)) seen.add(m), queue.push(m);
  }
  return false;
}

// ---------- reading ----------

export interface LinkView {
  id: string;
  type: string;
  /** outward: this item is the link's first item. */
  direction: 'outward' | 'inward';
  /** How the link reads from this item: "is blocked by". */
  phrase: string;
  note: string | null;
  item: Item;
}

type LinkRow = { id: string; from_kind: string; from_id: string; to_kind: string; to_id: string; type: string; note: string | null };

async function rowsOf(ctx: Ctx, r: Ref): Promise<LinkRow[]> {
  return (
    await ctx.db
      .prepare('SELECT * FROM links WHERE mode = ? AND ((from_kind = ? AND from_id = ?) OR (to_kind = ? AND to_id = ?)) ORDER BY created')
      .bind(ctx.mode, r.kind, r.id, r.kind, r.id)
      .all<LinkRow>()
  ).results;
}

/** An item's links, each read from the item ("blocks", "is blocked by" …), and what blocks it now. */
export async function relationsOf(ctx: Ctx, kind: string, id: string) {
  const me: Ref = { kind: kindOf(kind), id };
  const [rows, types] = await Promise.all([rowsOf(ctx, me), linkTypes(ctx)]);
  const isOut = (r: LinkRow) => r.from_kind === me.kind && r.from_id === me.id;
  const other = (r: LinkRow): Ref => (isOut(r) ? { kind: r.to_kind, id: r.to_id } : { kind: r.from_kind, id: r.from_id });
  const items = await fetchItems(ctx, [me, ...rows.map(other)]);
  const item = items.get(key(me));
  if (!item) throw notFound(LINKABLE[me.kind].label, id);
  const order = (t: string) => {
    const i = types.findIndex((x) => x.id === t);
    return i < 0 ? types.length : i;
  };
  const links: LinkView[] = [];
  for (const r of rows) {
    const o = items.get(key(other(r)));
    if (!o) continue;
    const t = types.find((x) => x.id === r.type) ?? { id: r.type, outward: r.type, inward: r.type };
    const out = isOut(r);
    links.push({ id: r.id, type: t.id, direction: out ? 'outward' : 'inward', phrase: out ? t.outward : t.inward, note: r.note, item: o });
  }
  links.sort((x, y) => order(x.type) - order(y.type) || (x.direction === y.direction ? 0 : x.direction === 'outward' ? -1 : 1));
  const blocking = new Set(types.filter((t) => t.blocking).map((t) => t.id));
  const blocked_by = links.filter((l) => l.direction === 'inward' && blocking.has(l.type) && l.item.status === 'open').map((l) => l.item);
  return { item, links, blocked_by };
}

/** For get_project and the project page: empty while the feature is off. */
export async function projectRelations(ctx: Ctx, id: string): Promise<{ links: LinkView[]; blocked_by: Item[] }> {
  if (!(await ctx.feature(FLAG))) return { links: [], blocked_by: [] };
  const { links, blocked_by } = await relationsOf(ctx, 'projects', id);
  return { links, blocked_by };
}

/** Every item blocked by an unfinished item now: { projects: { id: [blockers] }, tasks: {…} }. Empty while the feature is off. */
export async function blockedMap(ctx: Ctx): Promise<Record<string, Record<string, Item[]>>> {
  if (!(await ctx.feature(FLAG))) return {};
  const ids = (await linkTypes(ctx)).filter((t) => t.blocking).map((t) => t.id);
  const rows = (
    await ctx.db
      .prepare(`SELECT from_kind, from_id, to_kind, to_id FROM links WHERE mode = ? AND type IN (${ids.map(() => '?').join(',')})`)
      .bind(ctx.mode, ...ids)
      .all<LinkRow>()
  ).results;
  const items = await fetchItems(ctx, rows.map((r) => ({ kind: r.from_kind, id: r.from_id })));
  const out: Record<string, Record<string, Item[]>> = {};
  for (const r of rows) {
    const b = items.get(key({ kind: r.from_kind, id: r.from_id }));
    if (b?.status === 'open') ((out[r.to_kind] ??= {})[r.to_id] ??= []).push(b);
  }
  return out;
}

/** An SQL condition on projects.id leaving out blocked projects (for Today's suggestions). */
export async function notBlockedSql(ctx: Ctx): Promise<{ sql: string; params: string[] }> {
  const ids = Object.keys((await blockedMap(ctx)).projects ?? {});
  if (!ids.length) return { sql: '1 = 1', params: [] };
  return { sql: `id NOT IN (${ids.map(() => '?').join(',')})`, params: ids };
}

/** Items to link to, across kinds: titles containing q (all kinds, or one), or the latest changed when q is empty. */
export async function searchLinkable(ctx: Ctx, q: string, opts: { kind?: string; exclude?: Ref; limit?: number } = {}): Promise<Item[]> {
  const kinds = opts.kind ? [kindOf(opts.kind)] : Object.keys(LINKABLE);
  const limit = Math.min(opts.limit ?? 20, 50);
  const text = q.trim().toLowerCase();
  const like = `%${text.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
  const found = (
    await Promise.all(
      kinds.map(async (kind) => {
        const res = await ctx.db
          .prepare(`SELECT * FROM (${LINKABLE[kind].select}) ${text ? "WHERE title LIKE ? ESCAPE '\\'" : ''} ORDER BY updated_at DESC LIMIT ?`)
          .bind(...(text ? [ctx.mode, like, limit] : [ctx.mode, limit]))
          .all<Omit<Item, 'kind'> & { updated_at: string }>();
        return res.results.map((r) => ({ kind, ...r }));
      }),
    )
  )
    .flat()
    .filter((r) => !opts.exclude || key(r) !== key(opts.exclude));
  const rank = (r: Item) => (text && r.title.toLowerCase().startsWith(text) ? 0 : 1) * 2 + (r.status === 'done' ? 1 : 0);
  found.sort((a, b) => rank(a) - rank(b) || (b.updated_at < a.updated_at ? -1 : b.updated_at > a.updated_at ? 1 : 0));
  return found.slice(0, limit).map(({ updated_at: _u, ...r }) => r);
}

// ---------- changing ----------

export async function linkItems(ctx: Ctx, input: { from_kind: string; from_id: string; type: string; to_kind: string; to_id: string; note?: string | null }) {
  const row = await create(ctx, linksEntity, { ...input, note: input.note ?? null });
  const items = await fetchItems(ctx, [
    { kind: String(row.from_kind), id: String(row.from_id) },
    { kind: String(row.to_kind), id: String(row.to_id) },
  ]);
  const t = (await linkTypes(ctx)).find((x) => x.id === row.type)!;
  const a = items.get(`${row.from_kind}:${row.from_id}`)!;
  const b = items.get(`${row.to_kind}:${row.to_id}`)!;
  return { link: row, reads: `“${a.title}” ${t.outward} “${b.title}”` };
}

/** Remove one link by id, or the links between two items (of one type if given). */
export async function unlinkItems(ctx: Ctx, input: { id?: string; from_kind?: string; from_id?: string; to_kind?: string; to_id?: string; type?: string }) {
  if (input.id) {
    await remove(ctx, linksEntity, input.id);
    return { removed: 1 };
  }
  if (!input.from_id || !input.to_id) throw bad('Give the link id, or both items');
  const a: Ref = { kind: kindOf(input.from_kind ?? 'projects'), id: input.from_id };
  const b: Ref = { kind: kindOf(input.to_kind ?? 'projects'), id: input.to_id };
  const typeId = input.type ? resolveType(await linkTypes(ctx), input.type).type.id : null;
  const rows = (await rowsOf(ctx, a)).filter(
    (r) =>
      ((r.to_kind === b.kind && r.to_id === b.id) || (r.from_kind === b.kind && r.from_id === b.id)) && (!typeId || r.type === typeId),
  );
  if (!rows.length) throw bad('Those items are not linked');
  for (const r of rows) await remove(ctx, linksEntity, r.id);
  return { removed: rows.length };
}

/** Give one item's links to another (a backlog item started as a project keeps its links). */
export async function moveLinks(ctx: Ctx, from: Ref, to: Ref): Promise<void> {
  for (const r of await rowsOf(ctx, from)) {
    const copy = { ...r, id: undefined };
    if (r.from_kind === from.kind && r.from_id === from.id) Object.assign(copy, { from_kind: to.kind, from_id: to.id });
    else Object.assign(copy, { to_kind: to.kind, to_id: to.id });
    try {
      await create(ctx, linksEntity, { from_kind: copy.from_kind, from_id: copy.from_id, to_kind: copy.to_kind, to_id: copy.to_id, type: r.type, note: r.note });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 400)) throw err;
    }
  }
}

async function addType(ctx: Ctx, input: { outward?: string; inward?: string }) {
  const outward = String(input.outward ?? '').trim().toLowerCase();
  const inward = String(input.inward ?? '').trim().toLowerCase() || outward;
  if (!outward || outward.length > 40 || inward.length > 40) throw bad('A link type needs an outward phrase (and an inward one) of up to 40 letters');
  const types = await linkTypes(ctx);
  for (const t of types)
    for (const p of [t.outward, t.inward]) if ([outward, inward].includes(p.toLowerCase())) throw bad(`“${p}” is already a link phrase`);
  const slug = outward.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'type';
  let id = slug;
  for (let n = 2; types.some((t) => t.id === id); n++) id = `${slug}-${n}`;
  const custom = (await customTypes(ctx)).map(({ custom: _c, ...t }) => t);
  await ctx.setSetting(TYPES_SETTING, JSON.stringify([...custom, { id, outward, inward }]), '');
  return linkTypes(ctx);
}

async function deleteType(ctx: Ctx, id: string) {
  const custom = await customTypes(ctx);
  if (!custom.some((t) => t.id === id)) throw bad(LINK_TYPES.some((t) => t.id === id) ? 'Built-in link types cannot be removed' : `No link type ${id}`);
  const used = await ctx.db.prepare('SELECT COUNT(*) AS n FROM links WHERE type = ?').bind(id).first<{ n: number }>();
  if (used?.n) throw bad(`${used.n} link${used.n === 1 ? ' uses' : 's use'} this type. Remove ${used.n === 1 ? 'it' : 'them'} first.`);
  await ctx.setSetting(TYPES_SETTING, JSON.stringify(custom.filter((t) => t.id !== id).map(({ custom: _c, ...t }) => t)), '');
  return linkTypes(ctx);
}

// ---------- module ----------

const KIND_ARG = z.string().describe('project, card, todo, backlog or list');
const TYPE_LIST = LINK_TYPES.map((t) => (t.inward === t.outward ? `"${t.outward}"` : `"${t.outward}" / "${t.inward}"`)).join(', ');

export const relationsModule: Module = {
  id: 'relations',
  description: 'Issue links: typed relationships between projects, cards, to-dos, backlog items and lists.',
  entities: [linksEntity],
  features: [
    {
      id: FLAG,
      label: 'Issue links',
      description: 'Link projects, cards, to-dos, backlog items and lists (blocks, relates to, duplicates …). Blocked projects are left out of Today’s suggestions.',
      default: true,
    },
    {
      id: CUSTOM_FLAG,
      label: 'Custom link types',
      description: 'Add your own link types (a phrase each way) in Settings.',
      default: false,
    },
  ],
  async beforeDelete(ctx, e, row) {
    if (!LINKABLE[e.name]) return;
    for (const r of await rowsOf(ctx, { kind: e.name, id: row.id })) if (await getRaw(ctx, linksEntity, r.id)) await remove(ctx, linksEntity, r.id);
  },
  routes(api) {
    api.get('/links/types', async (c) => {
      const ctx = c.get('ctx');
      await requireFeature(ctx, FLAG);
      return c.json(await linkTypes(ctx));
    });
    api.post('/links/types', async (c) => {
      const ctx = c.get('ctx');
      await requireFeature(ctx, CUSTOM_FLAG);
      return c.json(await addType(ctx, await c.req.json()));
    });
    api.delete('/links/types/:id', async (c) => {
      const ctx = c.get('ctx');
      await requireFeature(ctx, CUSTOM_FLAG);
      return c.json(await deleteType(ctx, c.req.param('id')));
    });
    api.get('/links/of/:kind/:id', async (c) => {
      const ctx = c.get('ctx');
      await requireFeature(ctx, FLAG);
      return c.json(await relationsOf(ctx, c.req.param('kind'), c.req.param('id')));
    });
    api.get('/links/search', async (c) => {
      const ctx = c.get('ctx');
      await requireFeature(ctx, FLAG);
      const ex = c.req.query('exclude');
      const [k, i] = ex ? ex.split(':') : [];
      return c.json(await searchLinkable(ctx, c.req.query('q') ?? '', { kind: c.req.query('kind') || undefined, exclude: k && i ? { kind: kindOf(k), id: i } : undefined }));
    });
    api.get('/links/blocked', async (c) => c.json(await blockedMap(c.get('ctx'))));
    // The generic routes, with readable undo labels.
    api.post('/links', async (c) => {
      const ctx = c.get('ctx');
      ctx.label = 'link items';
      return c.json(await create(ctx, linksEntity, await c.req.json()), 201);
    });
    api.delete('/links/:id', async (c) => {
      const ctx = c.get('ctx');
      ctx.label = 'remove link';
      await remove(ctx, linksEntity, c.req.param('id'));
      return c.json({ deleted: c.req.param('id') });
    });
  },
  tools: [
    {
      name: 'link_items',
      feature: FLAG,
      description: `Link two items, Jira style; it reads "from <type> to" (a card "blocks" a project). Kinds: project, card, todo, backlog, list. Types: ${TYPE_LIST}, and custom ones from list_link_types; an inward phrase such as "is blocked by" swaps the ends. Refuses self-links, duplicates and loops. A project or card blocked by an unfinished item shows "Blocked by" and is left out of Today’s suggestions.`,
      input: z.object({
        from_kind: KIND_ARG,
        from_id: z.string(),
        type: z.string().describe('Type id or phrase, e.g. "blocks" or "is blocked by"'),
        to_kind: KIND_ARG,
        to_id: z.string(),
        note: z.string().optional(),
      }),
      run: (ctx, a) => linkItems(ctx, a),
    },
    {
      name: 'unlink_items',
      feature: FLAG,
      description: 'Remove a link by its id (from list_links or get_project), or every link between two items (of one type if given). Can be undone.',
      input: z.object({
        id: z.string().optional(),
        from_kind: KIND_ARG.optional(),
        from_id: z.string().optional(),
        to_kind: KIND_ARG.optional(),
        to_id: z.string().optional(),
        type: z.string().optional(),
      }),
      run: (ctx, a) => unlinkItems(ctx, a),
    },
    {
      name: 'list_links',
      feature: FLAG,
      description: 'An item’s links, each read from that item ("blocks", "is blocked by" …) with the other item’s title and status (open or done), and what blocks it now (blocked_by).',
      readOnly: true,
      input: z.object({ kind: KIND_ARG, id: z.string() }),
      run: (ctx, a) => relationsOf(ctx, a.kind, a.id),
    },
    {
      name: 'list_link_types',
      feature: FLAG,
      description: 'The link types with their outward and inward phrases, including any the owner added.',
      readOnly: true,
      input: z.object({}),
      run: (ctx) => linkTypes(ctx),
    },
  ],
};
