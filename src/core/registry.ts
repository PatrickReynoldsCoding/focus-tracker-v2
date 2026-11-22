// The list of feature modules and the entities they own.
// Adding a feature: write src/modules/<id>/index.ts and add it to MODULES in src/modules/index.ts.

import type { Hono } from 'hono';
import type { z } from 'zod';
import type { Ctx } from './ctx';
import type { Entity } from './entity';
import { bad } from './errors';

export interface Tool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  input: S;
  /** Read-only tools are marked as such for Claude. */
  readOnly?: boolean;
  /** Only offered to Claude while this feature flag is on (a list: while all are on). */
  feature?: string | string[];
  run(ctx: Ctx, args: z.infer<S>): Promise<unknown>;
}

export interface Module {
  id: string;
  /** One line about what the module does (shown in docs and to Claude). */
  description: string;
  entities?: Entity[];
  /** Extra REST routes, mounted under /api. */
  routes?(api: Hono<AppEnv>): void;
  tools?: Tool<any>[];
  /**
   * Runs before any row of any kind is deleted (after the entity's own onDelete), for
   * modules whose rows point at several kinds, such as issue links. Deletes made here
   * through the store are part of the same undo step.
   */
  beforeDelete?(ctx: Ctx, e: Entity, row: import('./entity').Row): Promise<void>;
  /**
   * Runs before any row of any kind is written through the store, after the entity's own
   * beforeCreate / beforeUpdate: `data` is the new row (creating, `before` is null) or the patch,
   * and may be changed. For modules that keep fields of other kinds in step (files: folder_id
   * and project_id).
   */
  beforeWrite?(ctx: Ctx, e: Entity, data: Record<string, unknown>, before: import('./entity').Row | null): Promise<void>;
  /** Runs after any row of any kind is created or changed through the store (same undo step). */
  afterWrite?(ctx: Ctx, e: Entity, row: import('./entity').Row, before: import('./entity').Row | null): Promise<void>;
  /** Kinds of rows the Files tab lists (src/core/files.ts). */
  files?: import('./files').FileSource[];
  /** Things attached to every file that the Files listing shows and filters by (tags; src/core/files.ts). */
  fileAddons?: import('./files').FileAddon[];
  /** Feature flags this module reads (src/core/features.ts). */
  features?: import('./features').Feature[];
  /** Old kinds kept for clients that still use them, stored as rows of another entity (D40: todos are cards). */
  aliases?: KindAlias[];
}

/**
 * A kind that is no longer a table of its own but still answers as one: the generic REST routes
 * (/api/<kind>), Claude's *_item tools and imports use these instead of the store.
 */
export interface KindAlias {
  name: string;
  singular: string;
  desc: string;
  /** The entity whose rows these are (a profile's counts take them out of it). */
  of: string;
  /** The fields as old clients know them (describe_kinds, filters). */
  fields: Record<string, import('./entity').Field>;
  list(ctx: Ctx, opts: import('./store').ListOptions): Promise<import('./entity').Row[]>;
  get(ctx: Ctx, id: string): Promise<import('./entity').Row>;
  create(ctx: Ctx, input: Record<string, unknown>, opts?: { raw?: boolean }): Promise<import('./entity').Row>;
  update(ctx: Ctx, id: string, input: Record<string, unknown>): Promise<import('./entity').Row>;
  remove(ctx: Ctx, id: string): Promise<import('./entity').Row>;
  move(ctx: Ctx, id: string, target: Record<string, unknown>): Promise<import('./entity').Row>;
  /** How many there are in a profile. */
  count(ctx: Ctx, mode: string): Promise<number>;
}

export type AppEnv = { Bindings: import('./ctx').Env; Variables: { ctx: Ctx } };

const entities = new Map<string, Entity>();
const aliases = new Map<string, KindAlias>();
const modules: Module[] = [];

export function register(mods: Module[]): void {
  if (modules.length) return;
  for (const m of mods) {
    modules.push(m);
    for (const f of m.features ?? []) {
      if (modules.some((o) => o !== m && o.features?.some((x) => x.id === f.id))) throw new Error(`Feature ${f.id} declared twice`);
    }
    for (const e of m.entities ?? []) {
      if (entities.has(e.name)) throw new Error(`Entity ${e.name} registered twice`);
      entities.set(e.name, e);
    }
    for (const a of m.aliases ?? []) aliases.set(a.name, a);
  }
  for (const a of aliases.values()) if (entities.has(a.name)) throw new Error(`Kind ${a.name} is both an entity and an alias`);
}

/** An old kind answered by a module (null for a real entity or an unknown kind). */
export const alias = (name: string): KindAlias | null => aliases.get(name) ?? null;
export const allAliases = () => [...aliases.values()];

export function entity(name: string): Entity {
  const e = entities.get(name);
  if (!e) throw bad(`Unknown kind "${name}". Kinds: ${[...entities.keys(), ...aliases.keys()].join(', ')}`);
  return e;
}

export const allEntities = () => [...entities.values()];
export const allModules = () => modules;
export const allTools = () => modules.flatMap((m) => m.tools ?? []);
