// Feature flags. A module declares the switches it reads (Module.features); the owner turns
// them on and off in Settings → Features. Each profile (mode) has its own set (settings row
// <mode> / 'features', DECISIONS D35), so a request's flags are those of its profile.
// Use a flag for big or experimental decisions, so a change can be tried and turned back
// without a deploy. Server code asks ctx.feature(id); a tool or route behind a flag says so.

import type { Ctx } from './ctx';
import { ApiError } from './errors';
import { allModules } from './registry';

export interface Feature {
  /** Short kebab-case id, unique across modules: 'issue-links'. */
  id: string;
  label: string;
  /** One line shown under the switch. */
  description: string;
  /** Value when the owner has not chosen. */
  default: boolean;
  /** Shown with an "Experimental" tag. */
  experimental?: boolean;
}

/** The settings key that holds a profile's chosen flags. */
export const FEATURES_KEY = 'features';

export const allFeatures = (): Feature[] => allModules().flatMap((m) => m.features ?? []);

/** Every flag's state, from a profile's chosen values (missing ones take their default). */
export function statesFrom(chosen: Record<string, boolean>): Record<string, boolean> {
  return Object.fromEntries(allFeatures().map((f) => [f.id, chosen[f.id] ?? f.default]));
}

/** Every flag's state in a profile (the request's own unless another is named). */
export async function featureStates(ctx: Ctx, mode: string = ctx.mode): Promise<Record<string, boolean>> {
  return statesFrom(await ctx.jsonSetting<Record<string, boolean>>(FEATURES_KEY, {}, mode));
}

export async function isOn(ctx: Ctx, id: string, mode: string = ctx.mode): Promise<boolean> {
  const f = allFeatures().find((x) => x.id === id);
  if (!f) throw new Error(`Unknown feature flag ${id}`);
  const chosen = await ctx.jsonSetting<Record<string, boolean>>(FEATURES_KEY, {}, mode);
  return chosen[id] ?? f.default;
}

/** Throw a 404 when a feature is off in the request's profile (for routes that belong to it). */
export async function requireFeature(ctx: Ctx, id: string): Promise<void> {
  if (!(await isOn(ctx, id))) throw new ApiError(404, `The feature "${id}" is turned off in this profile (Settings → Features)`, 'feature_off');
}

/** Switch a flag in the request's profile only. */
export async function setFeature(ctx: Ctx, id: string, enabled: boolean): Promise<Record<string, boolean>> {
  if (!allFeatures().some((f) => f.id === id)) throw new ApiError(400, `Unknown feature ${id}`);
  const chosen = await ctx.jsonSetting<Record<string, boolean>>(FEATURES_KEY, {}, ctx.mode);
  chosen[id] = enabled;
  await ctx.setSetting(FEATURES_KEY, JSON.stringify(chosen), ctx.mode);
  return featureStates(ctx);
}
