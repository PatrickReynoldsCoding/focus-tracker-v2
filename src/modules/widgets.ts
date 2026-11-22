// Widget feeds (DECISIONS D44): what the Android Files and Single file widgets show, in one small
// request each. A widget shows a file's title and the start of what is in it (a note's text as
// plain text, a list's or to-do's items), cut to the length the owner chose, so the phone never
// downloads whole notes. Each answer is one D1 round trip (one compound query, plus the source's
// name in the same batch), with SQL substr for note bodies and LIMITs on items, to stay inside the
// free plan's 10 ms of CPU. Read only: ticking a to-do from a widget uses POST /api/todos/:id/tick.

import { z } from 'zod';
import type { Ctx } from '../core/ctx';
import { bad, notFound } from '../core/errors';
import { requireFeature } from '../core/features';
import type { Module } from '../core/registry';
import { CATEGORY_PREFIX, isVirtual, NO_CATEGORY_ID, NO_CATEGORY_NAME, PROJECTS_ID, PROJECTS_NAME } from './files-tree';
import { AUTO_PREFIX } from './tags';

/** Hard caps, whatever a widget asks for. */
export const CAPS = {
  list: { files: 50, chars: 1000, lines: 30 },
  one: { chars: 4000, lines: 100 },
} as const;

/** The kinds of file a widget can show. 'others' in a request means whiteboards and links. */
export const WIDGET_KINDS = ['note', 'list', 'todo', 'project-note', 'whiteboard', 'link'] as const;
type Kind = (typeof WIDGET_KINDS)[number];
const DEFAULT_KINDS: Kind[] = ['note', 'list', 'todo', 'project-note'];

export interface WidgetItem {
  id: string;
  title: string;
  done: boolean;
}

export interface WidgetFile {
  kind: Kind;
  id: string;
  title: string;
  project_id: string | null;
  project: string | null;
  updated_at: string;
  /** The web app's address for it (after #), or null for a link (open `url`). */
  route: string | null;
  url?: string | null;
  /** Plain text, cut to the length asked for: a note's text, or a list's items one per line. */
  text: string;
  /** A list's or to-do's items (a to-do: open ones; the single file answer adds done ones after). */
  items?: WidgetItem[];
  /** A to-do's open items. */
  open?: number;
  /** There is more than was sent. */
  more: boolean;
}

// ---------- plain text ----------

/** Markdown as plain text for a widget: no marks, task boxes as ☐ ☑, bullets as •. Cheap on purpose. */
export function plainText(md: string): string {
  return md
    .replace(/\r\n?/g, '\n')
    .replace(/<[^>\n]{1,200}>/g, '')
    .replace(/^```.*$/gm, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^(\s*)[-*+]\s+\[[xX]\]\s+/gm, '$1☑ ')
    .replace(/^(\s*)[-*+]\s+\[ \]\s+/gm, '$1☐ ')
    .replace(/^(\s*)[-*+]\s+/gm, '$1• ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/(^|[\s(])[*_](?=\S)(.+?)(?<=\S)[*_](?=$|[\s).,!?:;])/gm, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^\s*([-*_])(\s*\1){2,}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Cut text to at most `lines` lines and `chars` characters, on a word where it can. */
export function cut(text: string, chars: number, lines: number | null): { text: string; cut: boolean } {
  let out = text;
  let was = false;
  if (lines != null) {
    const all = out.split('\n');
    if (all.length > lines) (out = all.slice(0, lines).join('\n')), (was = true);
  }
  if (out.length > chars) {
    const part = out.slice(0, chars);
    const space = part.lastIndexOf(' ');
    out = (space >= chars * 0.5 ? part.slice(0, space) : part).trimEnd();
    was = true;
  }
  return { text: was ? out + '…' : out, cut: was };
}

// ---------- the query ----------

type Scope =
  | { by: 'all' }
  | { by: 'root' }
  | { by: 'folder'; id: string; deep: boolean; virtual?: boolean }
  | { by: 'tag'; tag: string }
  | { by: 'one'; id: string };

/** Which rows of a table are in the scope. `a`: the table's alias; `tagKind`: its row kind in tag_links.
 *  ?1 mode, ?2 folder or file id, ?3 tag id or name. */
function scopeSql(s: Scope, a: string, tagKind: string, isProject = false): string {
  switch (s.by) {
    case 'all':
      return '1';
    case 'one':
      return `${a}.id = ?2`;
    case 'root':
      return isProject ? '0' : `${a}.folder_id IS NULL AND ${a}.project_id IS NULL`;
    case 'folder': {
      const projects = `SELECT project_id FROM folders WHERE mode = ?1 AND id IN (SELECT id FROM sub) AND project_id IS NOT NULL`;
      return isProject ? `${a}.id IN (${projects})` : `(${a}.folder_id IN (SELECT id FROM sub) OR (${a}.folder_id IS NULL AND ${a}.project_id IN (${projects})))`;
    }
    case 'tag': {
      // A tag of the owner's, or a project's automatic tag (D53: project:<id>, or the project's name).
      const project = isProject ? `${a}.id` : `${a}.project_id`;
      const own = `EXISTS (SELECT 1 FROM tag_links tl WHERE tl.mode = ?1 AND tl.kind = '${tagKind}' AND tl.target_id = ${a}.id AND tl.tag_id IN (SELECT id FROM tags WHERE mode = ?1 AND (id = ?3 OR name = ?3 COLLATE NOCASE)))`;
      const auto = `${project} IN (SELECT id FROM projects WHERE mode = ?1 AND ('${AUTO_PREFIX}' || id = ?3 OR name = ?3 COLLATE NOCASE))`;
      return `(${own} OR ${auto})`;
    }
  }
}

type Raw = {
  kind: Kind;
  id: string;
  title: string;
  project_id: string | null;
  project: string | null;
  changed: string;
  body: string | null;
  size: number | null;
  items: string | null;
  open: number | null;
  total: number | null;
  url: string | null;
};

interface QueryOptions {
  kinds: Kind[];
  /** Raw characters of a note to fetch. */
  chars: number;
  /** Items of a list to fetch. */
  items: number;
  /** A to-do's done items too (after the open ones). */
  done: boolean;
  sort: 'changed' | 'name';
  limit: number;
}

/** One compound SELECT over every kind asked for. ?4 note characters, ?5 items, ?6 limit. */
function query(s: Scope, o: QueryOptions): string {
  const parts: string[] = [];
  const listKinds = o.kinds.filter((k) => k === 'note' || k === 'list' || k === 'todo');
  // A to-do's open items in their order; done ones (in the Done column, last) only when asked.
  const doneCut = o.done ? '' : ` AND (l.kind != 'todo' OR t.done IS NULL)`;
  const itemsSql = `(SELECT json_group_array(json_array(i.id, i.title, i.done IS NOT NULL)) FROM (SELECT t.id, t.title, t.done FROM tasks t JOIN columns c ON c.id = t.column_id WHERE t.mode = ?1 AND t.list_id = l.id${doneCut} ORDER BY c.ord, t.ord LIMIT ?5) i)`;
  if (listKinds.length) {
    parts.push(
      `SELECT l.kind AS kind, l.id AS id, l.name AS title, l.project_id AS project_id, p.name AS project,
        MAX(l.updated_at, COALESCE(n.updated_at, ''), COALESCE((SELECT MAX(t.updated_at) FROM tasks t WHERE t.list_id = l.id), '')) AS changed,
        CASE WHEN l.kind = 'note' THEN substr(n.body, 1, ?4) END AS body, length(n.body) AS size,
        CASE WHEN l.kind != 'note' THEN ${itemsSql} END AS items,
        CASE WHEN l.kind != 'note' THEN (SELECT COUNT(*) FROM tasks t WHERE t.list_id = l.id AND (l.kind = 'list' OR t.done IS NULL)) END AS open,
        CASE WHEN l.kind != 'note' THEN (SELECT COUNT(*) FROM tasks t WHERE t.list_id = l.id${doneCut}) END AS total,
        NULL AS url
       FROM lists l LEFT JOIN notes n ON n.list_id = l.id LEFT JOIN projects p ON p.id = l.project_id
       WHERE l.mode = ?1 AND l.kind IN (${listKinds.map((k) => `'${k}'`).join(', ')}) AND ${scopeSql(s, 'l', 'lists')}`,
    );
  }
  if (o.kinds.includes('project-note')) {
    parts.push(
      `SELECT 'project-note' AS kind, p.id AS id, p.name || ' notes' AS title, p.id AS project_id, p.name AS project, COALESCE(n.updated_at, p.updated_at) AS changed,
        COALESCE(substr(n.body, 1, ?4), '') AS body, length(n.body) AS size, NULL AS items, NULL AS open, NULL AS total, NULL AS url
       FROM projects p LEFT JOIN notes n ON n.project_id = p.id
       WHERE p.mode = ?1 AND ${s.by === 'one' ? '1' : "n.body != ''"} AND ${scopeSql(s, 'p', 'project-notes', true)}`,
    );
  }
  if (o.kinds.includes('whiteboard')) {
    parts.push(
      `SELECT 'whiteboard' AS kind, w.id AS id, w.name AS title, w.project_id AS project_id, p.name AS project, w.updated_at AS changed,
        NULL AS body, NULL AS size, NULL AS items, NULL AS open, NULL AS total, NULL AS url
       FROM whiteboards w LEFT JOIN projects p ON p.id = w.project_id WHERE w.mode = ?1 AND ${scopeSql(s, 'w', 'whiteboards')}`,
    );
  }
  if (o.kinds.includes('link')) {
    parts.push(
      `SELECT 'link' AS kind, r.id AS id, r.title AS title, r.project_id AS project_id, p.name AS project, r.updated_at AS changed,
        NULL AS body, NULL AS size, NULL AS items, NULL AS open, NULL AS total, r.value AS url
       FROM resources r LEFT JOIN projects p ON p.id = r.project_id
       WHERE r.mode = ?1 AND r.type IN ('link', 'drive') AND NOT (r.project_id IS NULL AND r.category_id IS NOT NULL) AND ${scopeSql(s, 'r', 'resources')}`,
    );
  }
  if (!parts.length) parts.push(`SELECT NULL AS kind, NULL AS id, NULL AS title, NULL AS project_id, NULL AS project, NULL AS changed, NULL AS body, NULL AS size, NULL AS items, NULL AS open, NULL AS total, NULL AS url WHERE ?1 = 0`);
  // Projects and its category folders (D52) are not rows: they hold the folders of their projects (always all the way down).
  const start = s.by === 'folder' && s.virtual ? `project_id IN (SELECT id FROM projects WHERE mode = ?1 AND ${virtualProjects(s.id)})` : 'id = ?2';
  const deep = s.by === 'folder' && (s.deep || s.virtual);
  const sub =
    s.by === 'folder'
      ? `WITH RECURSIVE sub(id) AS (SELECT id FROM folders WHERE mode = ?1 AND ${start}${deep ? ' UNION SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id WHERE f.mode = ?1' : ''}) `
      : '';
  const order = o.sort === 'name' ? 'title COLLATE NOCASE, changed DESC' : 'changed DESC, title COLLATE NOCASE';
  // ?2 to ?6 are always bound: keep each one in the text so the count matches.
  const keep = ` AND ?2 IS NOT -1 AND ?3 IS NOT -1 AND ?4 > 0 AND ?5 > 0`;
  return `${sub}SELECT * FROM (${parts.join(' UNION ALL ')}) WHERE 1${keep} ORDER BY ${order} LIMIT ?6`;
}

/** Which projects a virtual folder holds (?2 is its id). */
function virtualProjects(id: string): string {
  if (id === PROJECTS_ID) return '1';
  if (id === NO_CATEGORY_ID) return '(category_id IS NULL OR category_id NOT IN (SELECT id FROM categories WHERE mode = ?1))';
  return `'${CATEGORY_PREFIX}' || category_id = ?2`;
}

const ROUTES: Record<Kind, (id: string) => string | null> = {
  note: (id) => `/n/${id}`,
  list: (id) => `/n/${id}`,
  todo: (id) => `/n/${id}`,
  'project-note': (id) => `/pn/${id}`,
  whiteboard: (id) => `/w/${id}`,
  link: () => null,
};

/** A raw row as the widget's file, cut to `chars` and `lines`. */
function shape(r: Raw, chars: number, lines: number | null, rawChars: number): WidgetFile {
  const out: WidgetFile = {
    kind: r.kind,
    id: r.id,
    title: r.title,
    project_id: r.project_id,
    project: r.project,
    updated_at: r.changed,
    route: ROUTES[r.kind](r.id),
    text: '',
    more: false,
  };
  if (r.kind === 'note' || r.kind === 'project-note') {
    const c = cut(plainText(r.body ?? ''), chars, lines);
    out.text = c.text;
    out.more = c.cut || (r.size ?? 0) > rawChars;
  } else if (r.kind === 'list' || r.kind === 'todo') {
    const all = (JSON.parse(r.items ?? '[]') as [string, string, number][]).map(([id, title, done]) => ({ id, title, done: !!done }));
    // As many items as fit in the length asked for (always the first one, cut if it must be).
    const items: WidgetItem[] = [];
    let used = 0;
    for (const it of all) {
      if (lines != null && items.length >= lines) break;
      if (items.length && used + it.title.length > chars) break;
      items.push(it.title.length > chars ? { ...it, title: cut(it.title, chars, null).text } : it);
      used += it.title.length + 1;
    }
    out.items = items;
    out.open = r.open ?? 0;
    const mark = (it: WidgetItem) => (r.kind === 'todo' ? (it.done ? '☑ ' : '☐ ') : '• ');
    out.text = items.map((it) => mark(it) + it.title).join('\n');
    out.more = items.length < (r.total ?? all.length);
  } else if (r.kind === 'link') {
    out.url = r.url;
    out.text = r.url ?? '';
  }
  return out;
}

/** A whole number; too big is cut to the cap later, not refused. */
const count = () => z.coerce.number().int().min(1);

function kindsOf(v: string | undefined): Kind[] {
  if (!v?.trim()) return DEFAULT_KINDS;
  const out = new Set<Kind>();
  for (const k of v.split(',').map((x) => x.trim().toLowerCase())) {
    if (k === 'others') (out.add('whiteboard'), out.add('link'));
    else if (k === 'default') DEFAULT_KINDS.forEach((d) => out.add(d));
    else if ((WIDGET_KINDS as readonly string[]).includes(k)) out.add(k as Kind);
    else throw bad(`Unknown kind "${k}". Kinds: ${WIDGET_KINDS.join(', ')}, others`);
  }
  return [...out];
}

const listQuery = z.object({
  folder: z.string().optional(),
  tag: z.string().optional(),
  deep: z.enum(['0', '1']).optional(),
  kinds: z.string().optional(),
  sort: z.enum(['changed', 'name']).optional(),
  limit: count().optional(),
  max: count().optional(),
  lines: count().optional(),
});

/** GET /api/widget/files: the files of a folder (folder=<id>, or root), a tag (tag=<id or name>) or
 *  the whole profile (neither), newest first, each cut to `max` characters and `lines` lines. */
export async function widgetFiles(ctx: Ctx, q: z.infer<typeof listQuery>) {
  if (q.folder && q.tag) throw bad('Give a folder or a tag, not both');
  if (q.tag) await requireFeature(ctx, 'tags');
  const scope: Scope = q.tag
    ? { by: 'tag', tag: q.tag.trim() }
    : q.folder === 'root'
      ? { by: 'root' }
      : q.folder
        ? { by: 'folder', id: q.folder, deep: q.deep !== '0', virtual: isVirtual(q.folder) }
        : { by: 'all' };
  const chars = Math.min(q.max ?? 200, CAPS.list.chars);
  const lines = q.lines != null ? Math.min(q.lines, CAPS.list.lines) : null;
  const limit = Math.min(q.limit ?? 20, CAPS.list.files);
  const rawChars = Math.min(chars * 2 + 100, CAPS.list.chars * 2);
  const opts: QueryOptions = { kinds: kindsOf(q.kinds), chars: rawChars, items: Math.min(lines ?? CAPS.list.lines, CAPS.list.lines), done: false, sort: q.sort ?? 'changed', limit: limit + 1 };
  const label =
    scope.by === 'folder'
      ? scope.virtual
        ? ctx.db
            .prepare(`SELECT ?2 AS id, CASE WHEN ?2 = '${PROJECTS_ID}' THEN '${PROJECTS_NAME}' WHEN ?2 = '${NO_CATEGORY_ID}' THEN '${NO_CATEGORY_NAME}' ELSE (SELECT label FROM categories WHERE mode = ?1 AND '${CATEGORY_PREFIX}' || id = ?2) END AS name, NULL AS project_id`)
            .bind(ctx.mode, scope.id)
        : ctx.db.prepare('SELECT id, name, project_id FROM folders WHERE mode = ? AND id = ?').bind(ctx.mode, scope.id)
      : scope.by === 'tag'
        ? ctx.db
            .prepare(`SELECT id, name, color FROM tags WHERE mode = ?1 AND (id = ?2 OR name = ?2 COLLATE NOCASE) UNION ALL SELECT '${AUTO_PREFIX}' || id, name, NULL FROM projects WHERE mode = ?1 AND ('${AUTO_PREFIX}' || id = ?2 OR name = ?2 COLLATE NOCASE)`)
            .bind(ctx.mode, scope.tag)
        : null;
  const main = ctx.db.prepare(query(scope, opts)).bind(ctx.mode, scope.by === 'folder' ? scope.id : '', scope.by === 'tag' ? scope.tag : '', opts.chars, opts.items, opts.limit);
  const [rows, src] = await ctx.db.batch<any>(label ? [main, label] : [main]);
  const found = (rows.results as Raw[]).filter((r) => r.id != null);
  const first = src?.results[0] as { id: string; name: string | null } | undefined;
  const source = scope.by === 'all' ? { by: 'all', name: 'All files' } : scope.by === 'root' ? { by: 'folder', id: 'root', name: 'Files' } : first?.name != null ? first : undefined;
  return {
    mode: ctx.mode,
    source: source ? { by: scope.by === 'tag' ? 'tag' : 'folder', ...source } : null,
    /** The folder or tag is gone (deleted, or in another profile). */
    missing: !source,
    files: found.slice(0, limit).map((r) => shape(r, chars, lines, opts.chars)),
    more: found.length > limit,
  };
}

const oneQuery = z.object({ max: count().optional(), lines: count().optional(), done: z.enum(['0', '1']).optional() });

/** GET /api/widget/file/:kind/:id: one file, cut to `max` characters and `lines` lines (a to-do's done items after its open ones unless done=0). */
export async function widgetFile(ctx: Ctx, kind: string, id: string, q: z.infer<typeof oneQuery>) {
  const k = kind.toLowerCase();
  if (!(WIDGET_KINDS as readonly string[]).includes(k)) throw bad(`Unknown kind "${kind}". Kinds: ${WIDGET_KINDS.join(', ')}`);
  // A note, list or to-do are all rows of lists: asking for one kind finds any of them (it may have been converted).
  const kinds: Kind[] = k === 'note' || k === 'list' || k === 'todo' ? ['note', 'list', 'todo'] : [k as Kind];
  const chars = Math.min(q.max ?? 1000, CAPS.one.chars);
  const lines = q.lines != null ? Math.min(q.lines, CAPS.one.lines) : null;
  const opts: QueryOptions = { kinds, chars: Math.min(chars * 2 + 100, CAPS.one.chars * 2), items: Math.min(lines ?? CAPS.one.lines, CAPS.one.lines), done: q.done !== '0', sort: 'changed', limit: 1 };
  const r = await ctx.db.prepare(query({ by: 'one', id }, opts)).bind(ctx.mode, id, '', opts.chars, opts.items, opts.limit).first<Raw>();
  if (!r?.id) throw notFound('file', id);
  return { mode: ctx.mode, file: shape(r, chars, lines, opts.chars) };
}

export const widgetsModule: Module = {
  id: 'widgets',
  description: 'Short feeds for the Android Files and Single file widgets: titles and the start of each file, cut to a length.',
  routes(api) {
    api.get('/widget/files', async (c) => c.json(await widgetFiles(c.get('ctx'), listQuery.parse(c.req.query()))));
    api.get('/widget/file/:kind/:id', async (c) => c.json(await widgetFile(c.get('ctx'), c.req.param('kind'), c.req.param('id'), oneQuery.parse(c.req.query()))));
  },
};
