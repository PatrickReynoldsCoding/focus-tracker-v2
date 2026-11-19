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
  /** Only listed while this flag is on. */
  feature?: string;
  /**
   * Every file of this type in the mode, or those whose name (or, where cheap, text) contains
   * `like` (an SQL LIKE pattern, already escaped with \\).
   */
  list(ctx: Ctx, like: string | null): Promise<FileItem[]>;
}

/** A LIKE pattern for a search, escaped with \\. */
export const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
