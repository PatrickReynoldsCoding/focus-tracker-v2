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
  /** Only offered to Claude while this feature flag is on. */
  feature?: string;
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
  /** Feature flags this module reads (src/core/features.ts). */
  features?: import('./features').Feature[];
}

export type AppEnv = { Bindings: import('./ctx').Env; Variables: { ctx: Ctx } };

const entities = new Map<string, Entity>();
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
  }
}

export function entity(name: string): Entity {
  const e = entities.get(name);
  if (!e) throw bad(`Unknown kind "${name}". Kinds: ${[...entities.keys()].join(', ')}`);
  return e;
}

export const allEntities = () => [...entities.values()];
export const allModules = () => modules;
export const allTools = () => modules.flatMap((m) => m.tools ?? []);
