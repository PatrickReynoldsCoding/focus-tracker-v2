// The Files tab's plug-in point on the server. A module that owns rows people think of as files
// (notes, lists, whiteboards, links) lists them in `Module.files`; src/modules/files.ts puts them
// in folders, filters, searches and moves them, and gives Claude its file tools. A new kind of
// file plugs in here without changes to the Files module.

import type { Ctx } from './ctx';

/** One file as the Files tab lists it. */
export interface FileItem {
  /** The source's type: 'note', 'todo', 'list', 'whiteboard', 'link', 'project-note' ... */
  type: string;
  id: string;
  name: string;
  /** The folder it is in. null with a project_id: the project's folder. */
  folder_id: string | null;
  project_id: string | null;
  /** Last changed: the row or what is in it (a note's text, a list's items). */
  updated_at: string;
  created: string;
  show_today?: boolean;
  /** A short bit of text to show (a note's first lines). */
  preview?: string | null;
  /** A link's kind (doc, sheet, pdf ...), for its icon. */
  kind?: string | null;
  /** A link's address. */
  url?: string | null;
  /** How many items (a list), or open to-dos (a to-do list). */
  count?: number | null;
  /** A whiteboard has a preview image (GET /api/whiteboards/:id/thumbnail). */
  thumbnail?: boolean;
  /** Listed only inside its project's folder (a project's empty notes). */
  quiet?: boolean;
  /** Its tags (src/modules/tags.ts, while the tags flag is on); a project's automatic tag first (auto: true). */
  tags?: { id: string; name: string; color: string | null; auto?: true; project_id?: string }[];
}

export interface FileSource {
  /** Unique across sources. */
  type: string;
  /** The filter chip it belongs to: 'notes', 'lists', 'whiteboards', 'links'. */
  group: string;
  /** "Note", "To-do list" ... */
  label: string;
  /** The entity whose rows these are; it has a folder_id field, so they can be moved. None: fixed in place. */
  entity?: string;
  /** The kind of row a file of this type is, for what is attached to files (tags): `entity` when
   *  not given. A project's notes are 'project-notes' (their id is the project's). */
  rowKind?: string;
  /** Only listed while this flag is on. */
  feature?: string;
  /**
   * Every file of this type in the mode, or those whose name (or, where cheap, text) contains
   * `like` (an SQL LIKE pattern, already escaped with \\).
   */
  list(ctx: Ctx, like: string | null): Promise<FileItem[]>;
  /**
   * How a file of this type is a panel on Today (Add panel's file picker, Claude's add_panel): its
   * panel id is `prefix` + the file's id, and `set` puts it on Today or takes it off. None: it
   * cannot be a panel (a link).
   */
  today?: { prefix: string; set(ctx: Ctx, id: string, on: boolean): Promise<unknown> };
}

/** A LIKE pattern for a search, escaped with \\. */
export const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;

/** The kind of row a file of this source is (for tags and other things attached to files). */
export const rowKindOf = (s: FileSource): string => s.rowKind ?? s.entity ?? s.type;

/**
 * Something attached to every file that the Files listing shows, filters and searches by, without
 * the Files module knowing what it is (tags: src/modules/tags.ts). A module lists them in
 * `Module.fileAddons`. `keyOf(file)` is `<row kind>:<id>`, the same for a file whatever its type.
 */
export interface FileAddon {
  id: string;
  /** Only used while this flag is on. */
  feature?: string;
  /** Add fields to each listed file (its tags). Runs on every file found, before filtering. */
  decorate?(ctx: Ctx, files: FileItem[], keyOf: (f: FileItem) => string): Promise<void>;
  /** Files that match a search some other way (a tag's name): a test for a file and its key, or
   *  null when nothing can match. */
  search?(ctx: Ctx, like: string): Promise<((f: FileItem, key: string) => boolean) | null>;
  /** A query parameter of GET /api/files (and list_files) that narrows the files; given a value,
   *  the listing looks in the folder and everything inside it, as a search does. */
  filter?: { param: string; apply(ctx: Ctx, files: FileItem[], value: string): Promise<FileItem[]> };
}
