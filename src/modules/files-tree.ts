// The Files tree's top (DECISIONS D52): the top level shows one folder, "Projects"; inside it one
// folder per category (in the categories' order, with their colour) and "No category"; inside each
// of those the folders of its projects. These folders are virtual: worked out from the categories
// and the projects' category_id on every read, never stored, so they follow a category's rename,
// colour, order and deletion with nothing to keep in step, and no data changed to make them.
// A project's own folder is still a row of `folders` (id, name, D31's rules); it is shown inside
// its category's folder whatever its parent_id (kept null). Moving it to another category's
// folder changes the project's category.

import type { Ctx } from '../core/ctx';
import { bad } from '../core/errors';

/** "Projects", at the top level. */
export const PROJECTS_ID = 'vf:projects';
/** A category's folder: this prefix and the category's id. */
export const CATEGORY_PREFIX = 'vf:cat:';
/** Projects with no category. */
export const NO_CATEGORY_ID = 'vf:nocat';
export const NO_CATEGORY_NAME = 'No category';
export const PROJECTS_NAME = 'Projects';

/** Real folder ids are made with newId or by clients (letters, digits, _ and -), never with a colon. */
export const isVirtual = (id: unknown): id is string => typeof id === 'string' && id.startsWith('vf:');
export const categoryFolderId = (categoryId: string | null): string => (categoryId ? CATEGORY_PREFIX + categoryId : NO_CATEGORY_ID);
/** The category a virtual folder stands for: its id, null for No category, undefined for anything else. */
export function categoryOfFolder(id: unknown): string | null | undefined {
  if (id === NO_CATEGORY_ID) return null;
  if (typeof id === 'string' && id.startsWith(CATEGORY_PREFIX) && id.length > CATEGORY_PREFIX.length) return id.slice(CATEGORY_PREFIX.length);
  return undefined;
}

export type FolderRow = { id: string; name: string; parent_id: string | null; project_id: string | null; created: string; updated_at: string };
/** A folder as the Files tab shows it: a real one (with its parent as shown) or a virtual one. */
export type TreeFolder = FolderRow & {
  virtual?: 'projects' | 'category';
  /** A category folder's category (null: No category). */
  category_id?: string | null;
  /** A category folder's colour (a palette name or #rrggbb). */
  color?: string | null;
  /** Folders inside (a category folder: its projects; Projects: its category folders). */
  count?: number;
  ord?: number;
};
export type TreeProject = { id: string; category_id: string | null };
export type TreeCategory = { id: string; label: string; color: string | null; ord: number };

/** Every folder of a profile as shown, by id: the real ones (project folders under their
 *  category's folder) and the virtual ones (Projects first, then the categories, No category last). */
export function buildTree(real: Map<string, FolderRow>, projects: TreeProject[], categories: TreeCategory[]): Map<string, TreeFolder> {
  const cats = [...categories].sort((a, b) => a.ord - b.ord);
  const known = new Set(cats.map((c) => c.id));
  const categoryOf = new Map(projects.map((p) => [p.id, p.category_id && known.has(p.category_id) ? p.category_id : null]));
  const out = new Map<string, TreeFolder>();
  const top: TreeFolder = { id: PROJECTS_ID, name: PROJECTS_NAME, parent_id: null, project_id: null, created: '', updated_at: '', virtual: 'projects', count: cats.length + 1, ord: 0 };
  out.set(top.id, top);
  const virtualOf = (id: string | null, name: string, color: string | null, ord: number): TreeFolder => ({
    id: categoryFolderId(id),
    name,
    parent_id: PROJECTS_ID,
    project_id: null,
    created: '',
    updated_at: '',
    virtual: 'category',
    category_id: id,
    color,
    count: 0,
    ord,
  });
  cats.forEach((c, i) => out.set(categoryFolderId(c.id), virtualOf(c.id, c.label, c.color, i)));
  out.set(NO_CATEGORY_ID, virtualOf(null, NO_CATEGORY_NAME, null, cats.length));
  for (const f of real.values()) {
    if (!f.project_id) {
      out.set(f.id, f);
      continue;
    }
    const holder = out.get(categoryFolderId(categoryOf.get(f.project_id) ?? null))!;
    out.set(f.id, { ...f, parent_id: holder.id });
    holder.count = (holder.count ?? 0) + 1;
    // A virtual folder was last changed when the newest folder in it was.
    if (f.updated_at > holder.updated_at) holder.updated_at = f.updated_at;
    if (f.created && (!holder.created || f.created < holder.created)) holder.created = f.created;
    if (f.updated_at > top.updated_at) top.updated_at = f.updated_at;
    if (f.created && (!top.created || f.created < top.created)) top.created = f.created;
  }
  return out;
}

/** Read the tree of the profile (three small queries in one batch). */
export async function readTree(ctx: Ctx): Promise<{ tree: Map<string, TreeFolder>; real: Map<string, FolderRow>; projects: (TreeProject & { name: string; status: string })[] }> {
  const [f, p, c] = await ctx.db.batch<any>([
    ctx.db.prepare('SELECT id, name, parent_id, project_id, created, updated_at FROM folders WHERE mode = ?').bind(ctx.mode),
    ctx.db.prepare('SELECT id, name, status, category_id FROM projects WHERE mode = ?').bind(ctx.mode),
    ctx.db.prepare('SELECT id, label, color, ord FROM categories WHERE mode = ?').bind(ctx.mode),
  ]);
  const real = new Map((f.results as FolderRow[]).map((x) => [x.id, x]));
  const projects = p.results as (TreeProject & { name: string; status: string })[];
  return { tree: buildTree(real, projects, c.results as TreeCategory[]), real, projects };
}

/** Why something cannot go into a virtual folder (a project's folder can go into a category's). */
export function refuseVirtualTarget(target: TreeFolder | undefined, what: 'file' | 'folder' | 'project-folder'): void {
  if (!target?.virtual) return;
  if (what === 'project-folder' && target.virtual === 'category') return;
  if (what === 'project-folder') throw bad(`“${target.name}” holds a folder per category: move a project’s folder into a category’s folder`);
  if (target.virtual === 'projects') throw bad(`“${PROJECTS_NAME}” holds a folder per category, made from your categories: put ${what === 'file' ? 'files' : 'folders'} in a project’s folder or one of your own`);
  throw bad(`“${target.name}” holds the folders of its projects only: put ${what === 'file' ? 'files' : 'folders'} in a project’s folder or one of your own`);
}
