// An entity is one table described once. The generic store (store.ts), the
// REST routes (api.ts) and the MCP tools (mcp/server.ts) all read this
// description, so a new table needs no hand-written CRUD.

import type { Ctx } from './ctx';

export type FieldType = 'text' | 'int' | 'real' | 'bool' | 'day' | 'time' | 'json' | 'markdown';

export interface Field {
  type: FieldType;
  /** Must be given when a row is created. */
  required?: boolean;
  /** Allowed values. */
  enum?: readonly string[];
  /** Name of the entity this id points at (checked to exist in the same mode). */
  ref?: string;
  /** One line for Claude and for the docs. */
  desc?: string;
  /** Value used when a row is created without this field. */
  default?: unknown;
  /** Set by the app only; ignored in input. */
  readonly?: boolean;
  /** For a ref: delete this row when the row it points at is deleted (otherwise the ref is cleared). */
  cascade?: boolean;
}

export type Row = Record<string, unknown> & { id: string };

export interface Entity {
  /** Plural, as used in URLs and tool arguments: 'projects'. */
  name: string;
  table: string;
  singular: string;
  desc: string;
  fields: Record<string, Field>;
  /** Rows belong to a mode (Personal, Work). */
  modeScoped: boolean;
  /** Rows are ordered by `ord` within groups of rows that share these fields. */
  orderGroup?: string[];
  /** Fields the list endpoint may filter on (besides mode). */
  filters?: string[];
  /** ORDER BY clause for lists. */
  sort?: string;
  /** Not editable through the generic endpoints (managed by a module). */
  internal?: boolean;
  /** Run before a row is written. May change `row` or throw ApiError. */
  beforeCreate?(ctx: Ctx, row: Record<string, unknown>): Promise<void> | void;
  beforeUpdate?(ctx: Ctx, before: Row, patch: Record<string, unknown>): Promise<void> | void;
  afterCreate?(ctx: Ctx, row: Row): Promise<void> | void;
  /** Delete or detach child rows. Runs before the row itself is deleted. */
  onDelete?(ctx: Ctx, row: Row): Promise<void> | void;
}

export const BASE_FIELDS = ['id', 'mode', 'created', 'updated_at'] as const;

export function columnsOf(e: Entity): string[] {
  const cols = ['id', ...Object.keys(e.fields), 'created', 'updated_at'];
  if (e.modeScoped) cols.splice(1, 0, 'mode');
  if (e.orderGroup && !cols.includes('ord')) cols.push('ord');
  return cols;
}
