// Feature flags. A module declares the switches it reads (Module.features); the owner turns
// them on and off in Settings → Features (stored once per deployment, settings row '' / 'features').
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

export const allFeatures = (): Feature[] => allModules().flatMap((m) => m.features ?? []);

export async function featureStates(ctx: Ctx): Promise<Record<string, boolean>> {
  const chosen = await ctx.jsonSetting<Record<string, boolean>>('features', {}, '');
  return Object.fromEntries(allFeatures().map((f) => [f.id, chosen[f.id] ?? f.default]));
}

export async function isOn(ctx: Ctx, id: string): Promise<boolean> {
  const f = allFeatures().find((x) => x.id === id);
  if (!f) throw new Error(`Unknown feature flag ${id}`);
  const chosen = await ctx.jsonSetting<Record<string, boolean>>('features', {}, '');
  return chosen[id] ?? f.default;
}

/** Throw a 404 when a feature is off (for routes that belong to it). */
export async function requireFeature(ctx: Ctx, id: string): Promise<void> {
  if (!(await isOn(ctx, id))) throw new ApiError(404, `The feature "${id}" is turned off (Settings → Features)`, 'feature_off');
}

export async function setFeature(ctx: Ctx, id: string, enabled: boolean): Promise<Record<string, boolean>> {
  if (!allFeatures().some((f) => f.id === id)) throw new ApiError(400, `Unknown feature ${id}`);
  const chosen = await ctx.jsonSetting<Record<string, boolean>>('features', {}, '');
  chosen[id] = enabled;
  await ctx.setSetting('features', JSON.stringify(chosen), '');
  return featureStates(ctx);
}
